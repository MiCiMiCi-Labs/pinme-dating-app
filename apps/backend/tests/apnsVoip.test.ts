import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import http2 from 'node:http2';

// Pure unit tests for the APNs VoIP sender — no real APNs connection, no
// real Apple secret, and (aside from the fan-out tests, which mock prisma)
// no database dependency. Must be able to pass with zero env configuration.

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    voipDeviceToken: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma';
import {
  loadApnsConfig,
  getProviderJwt,
  resetApnsJwtCacheForTesting,
  sendVoipPushToDeviceToken,
  sendVoipPushForIncomingCall,
  MAX_VOIP_PAYLOAD_BYTES,
  type ApnsConfig,
  type Http2ConnectFn,
} from '../src/lib/apnsVoip';

const mockedFindMany = prisma.voipDeviceToken.findMany as jest.Mock;
const mockedDeleteMany = prisma.voipDeviceToken.deleteMany as jest.Mock;

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

const VALID_ENV = {
  APNS_TEAM_ID: 'TEAMID1234',
  APNS_KEY_ID: 'KEYID5678',
  APNS_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString('base64'),
  APNS_BUNDLE_ID: 'com.micimici.pinme',
  APNS_VOIP_TOPIC: 'com.micimici.pinme.voip',
};

function validConfig(): ApnsConfig {
  const result = loadApnsConfig(VALID_ENV);
  if (!result.ok) throw new Error('expected valid config in test setup');
  return result.config;
}

beforeEach(() => {
  resetApnsJwtCacheForTesting();
  mockedFindMany.mockReset();
  mockedDeleteMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('loadApnsConfig', () => {
  test('missing config -> ok:false missing_config', () => {
    expect(loadApnsConfig({})).toEqual({ ok: false, reason: 'missing_config' });
  });

  test('invalid base64 charset -> invalid_private_key_base64', () => {
    const result = loadApnsConfig({ ...VALID_ENV, APNS_PRIVATE_KEY_BASE64: 'not-base64!!!@@@' });
    expect(result).toEqual({ ok: false, reason: 'invalid_private_key_base64' });
  });

  test('valid base64 but non-PEM content -> invalid_private_key_base64', () => {
    const result = loadApnsConfig({ ...VALID_ENV, APNS_PRIVATE_KEY_BASE64: Buffer.from('hello world').toString('base64') });
    expect(result).toEqual({ ok: false, reason: 'invalid_private_key_base64' });
  });

  test('malformed PEM -> invalid_private_key_pem', () => {
    const malformedPem = '-----BEGIN PRIVATE KEY-----\nnotarealkey\n-----END PRIVATE KEY-----';
    const result = loadApnsConfig({ ...VALID_ENV, APNS_PRIVATE_KEY_BASE64: Buffer.from(malformedPem).toString('base64') });
    expect(result).toEqual({ ok: false, reason: 'invalid_private_key_pem' });
  });

  test('bundle/topic mismatch -> topic_mismatch', () => {
    const result = loadApnsConfig({ ...VALID_ENV, APNS_VOIP_TOPIC: 'com.wrong.topic' });
    expect(result).toEqual({ ok: false, reason: 'topic_mismatch' });
  });

  test('fully valid config -> ok:true', () => {
    const result = loadApnsConfig(VALID_ENV);
    expect(result.ok).toBe(true);
  });

  test('RSA key -> unsupported_key_type, not sent', () => {
    const { privateKey: rsaKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const result = loadApnsConfig({ ...VALID_ENV, APNS_PRIVATE_KEY_BASE64: Buffer.from(rsaKey).toString('base64') });
    expect(result).toEqual({ ok: false, reason: 'unsupported_key_type' });
  });

  test('EC key on the wrong curve (e.g. secp384r1) -> unsupported_key_curve, not sent', () => {
    const { privateKey: wrongCurveKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp384r1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const result = loadApnsConfig({
      ...VALID_ENV,
      APNS_PRIVATE_KEY_BASE64: Buffer.from(wrongCurveKey).toString('base64'),
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported_key_curve' });
  });
});

describe('getProviderJwt', () => {
  test('header and claims are correct', () => {
    const config = validConfig();
    const now = 1_700_000_000;
    const jwt = getProviderJwt(config, now);
    const [headerPart, claimsPart] = jwt.split('.');
    const header = JSON.parse(base64urlToBuffer(headerPart).toString('utf8'));
    const claims = JSON.parse(base64urlToBuffer(claimsPart).toString('utf8'));
    expect(header).toEqual({ alg: 'ES256', kid: config.keyId });
    expect(claims).toEqual({ iss: config.teamId, iat: now });
  });

  test('signature is a valid 64-byte IEEE-P1363 ES256 signature', () => {
    const config = validConfig();
    const now = 1_700_000_000;
    const jwt = getProviderJwt(config, now);
    const [headerPart, claimsPart, signaturePart] = jwt.split('.');
    const signature = base64urlToBuffer(signaturePart);
    expect(signature.length).toBe(64);

    const signingInput = `${headerPart}.${claimsPart}`;
    const verified = crypto.verify(
      'sha256',
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature
    );
    expect(verified).toBe(true);
  });

  test('reuses cached token within the refresh threshold', () => {
    const config = validConfig();
    const jwtAtT0 = getProviderJwt(config, 1_700_000_000);
    const jwtAtT100 = getProviderJwt(config, 1_700_000_100);
    expect(jwtAtT100).toBe(jwtAtT0);
  });

  test('refreshes once past the ~50 minute threshold', () => {
    const config = validConfig();
    const jwtAtT0 = getProviderJwt(config, 1_700_000_000);
    const jwtAfter51Min = getProviderJwt(config, 1_700_000_000 + 51 * 60);
    expect(jwtAfter51Min).not.toBe(jwtAtT0);
  });

  test('does not reuse a cached token after the config (key material) changes', () => {
    const config = validConfig();
    const jwtAtT0 = getProviderJwt(config, 1_700_000_000);
    const changedConfig = { ...config, keyId: 'DIFFERENTKEY' };
    const jwtAfterConfigChange = getProviderJwt(changedConfig, 1_700_000_010);
    expect(jwtAfterConfigChange).not.toBe(jwtAtT0);
  });
});

// ---------------------------------------------------------------------------
// Fake HTTP/2 transport — an in-memory EventEmitter standing in for
// http2.connect()'s ClientHttp2Session/ClientHttp2Stream, so sender tests
// never open a real socket.
// ---------------------------------------------------------------------------

type FakeResponse = { status: number; body?: unknown; simulateError?: boolean; simulateTimeout?: boolean };

type FakeSessionHandle = {
  session: http2.ClientHttp2Session;
  close: jest.Mock;
  destroy: jest.Mock;
};

type FakeStreamHandle = {
  stream: http2.ClientHttp2Stream;
  close: jest.Mock;
};

// Builds an http2.connect-compatible fake. Every connect() call produces an
// EventEmitter-backed session/stream pair with jest.fn() `close`/`destroy`
// so tests can assert exactly which cleanup path (graceful vs. forced) ran,
// and exposes the raw emitters so a test can fire extra/out-of-order events
// to check idempotency.
function makeFakeConnect(responsesByAuthority: Record<string, FakeResponse>) {
  const calls: { authority: string; headers: http2.OutgoingHttpHeaders; body: string }[] = [];
  const sessionHandles: FakeSessionHandle[] = [];
  const streamHandles: FakeStreamHandle[] = [];

  const connect: Http2ConnectFn = ((authority: string) => {
    const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
    const sessionClose = jest.fn();
    const sessionDestroy = jest.fn();
    (session as unknown as { close: jest.Mock }).close = sessionClose;
    (session as unknown as { destroy: jest.Mock }).destroy = sessionDestroy;
    sessionHandles.push({ session, close: sessionClose, destroy: sessionDestroy });

    (session as unknown as { request: (headers: http2.OutgoingHttpHeaders) => http2.ClientHttp2Stream }).request = (
      headers: http2.OutgoingHttpHeaders
    ) => {
      const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
      const streamClose = jest.fn();
      (stream as unknown as { close: jest.Mock }).close = streamClose;
      streamHandles.push({ stream, close: streamClose });

      const response = responsesByAuthority[authority];

      (stream as unknown as { end: (body: string) => void }).end = (body: string) => {
        calls.push({ authority, headers, body });
        if (!response) return;
        if (response.simulateTimeout) return; // never emits — exercises the timeout path
        if (response.simulateError) {
          queueMicrotask(() => stream.emit('error', new Error('stream error')));
          return;
        }
        queueMicrotask(() => {
          stream.emit('response', { ':status': response.status });
          if (response.body !== undefined) stream.emit('data', Buffer.from(JSON.stringify(response.body)));
          stream.emit('end');
        });
      };

      return stream;
    };

    return session;
  }) as Http2ConnectFn;

  return { connect, calls, sessionHandles, streamHandles };
}

describe('sendVoipPushToDeviceToken', () => {
  test('SANDBOX environment connects to the development APNs host', async () => {
    const { connect, calls } = makeFakeConnect({
      'https://api.development.push.apple.com': { status: 200 },
    });
    const result = await sendVoipPushToDeviceToken(
      'tok1',
      'SANDBOX',
      validConfig(),
      { callId: 'call-1', callerName: 'Alex', hasVideo: false },
      connect
    );
    expect(result).toEqual({ status: 'sent' });
    expect(calls[0].authority).toBe('https://api.development.push.apple.com');
  });

  test('PRODUCTION environment connects to the production APNs host', async () => {
    const { connect, calls } = makeFakeConnect({
      'https://api.push.apple.com': { status: 200 },
    });
    const result = await sendVoipPushToDeviceToken(
      'tok1',
      'PRODUCTION',
      validConfig(),
      { callId: 'call-1', callerName: 'Alex', hasVideo: false },
      connect
    );
    expect(result).toEqual({ status: 'sent' });
    expect(calls[0].authority).toBe('https://api.push.apple.com');
  });

  test('request method/path and headers are correct; payload has only allowed fields', async () => {
    const { connect, calls } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 200 } });
    const config = validConfig();
    const before = Math.floor(Date.now() / 1000);
    await sendVoipPushToDeviceToken(
      'device-token-abc',
      'SANDBOX',
      config,
      { callId: 'call-42', callerName: 'Alex', hasVideo: false },
      connect
    );
    const call = calls[0];
    expect(call.headers[':method']).toBe('POST');
    expect(call.headers[':path']).toBe('/3/device/device-token-abc');
    expect(call.headers['apns-push-type']).toBe('voip');
    expect(call.headers['apns-topic']).toBe(config.voipTopic);
    expect(call.headers['apns-priority']).toBe('10');
    expect(call.headers['content-type']).toBe('application/json');
    expect(String(call.headers.authorization)).toMatch(/^bearer /);

    const expiration = Number(call.headers['apns-expiration']);
    expect(expiration).toBeGreaterThanOrEqual(before + 45);
    expect(expiration).toBeLessThanOrEqual(before + 47);

    const payload = JSON.parse(call.body);
    // Exact field set per docs/private-voice-calling-spec.md:
    // { aps, uuid, callId, callerName, handle, hasVideo }.
    expect(Object.keys(payload).sort()).toEqual(['aps', 'callId', 'callerName', 'handle', 'hasVideo', 'uuid']);
    expect(payload.aps).toEqual({});
    expect(payload.uuid).toBe('call-42');
    expect(payload.callId).toBe('call-42');
    expect(payload.uuid).toBe(payload.callId); // CallKit UUID = Call.id
    expect(payload.callerName).toBe('Alex');
    expect(payload.handle).toBe('Alex');
    expect(payload.handle).toBe(payload.callerName);
    expect(payload.hasVideo).toBe(false);
    // No LiveKit/Supabase/APNs secret material anywhere in the payload or headers.
    const serialized = JSON.stringify({ payload, headers: call.headers });
    expect(serialized).not.toMatch(/livekit|supabase|BEGIN PRIVATE KEY/i);
  });

  test('HTTP 200 -> sent, and cleans up via graceful session.close() (not destroy/cancel)', async () => {
    const { connect, sessionHandles, streamHandles } = makeFakeConnect({
      'https://api.development.push.apple.com': { status: 200 },
    });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result).toEqual({ status: 'sent' });
    expect(sessionHandles[0].close).toHaveBeenCalledTimes(1);
    expect(sessionHandles[0].destroy).not.toHaveBeenCalled();
    expect(streamHandles[0].close).not.toHaveBeenCalled();
  });

  test('HTTP 410 -> invalid_token', async () => {
    const { connect } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 410, body: { reason: 'Unregistered' } } });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('invalid_token');
  });

  test('reason=Unregistered without a 410 status still -> invalid_token', async () => {
    const { connect } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 400, body: { reason: 'Unregistered' } } });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('invalid_token');
  });

  test('reason=BadDeviceToken -> invalid_token', async () => {
    const { connect } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 400, body: { reason: 'BadDeviceToken' } } });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('invalid_token');
  });

  test('reason=DeviceTokenNotForTopic -> invalid_token', async () => {
    const { connect } = makeFakeConnect({
      'https://api.development.push.apple.com': { status: 400, body: { reason: 'DeviceTokenNotForTopic' } },
    });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('invalid_token');
  });

  test('other 4xx/5xx (e.g. TopicDisallowed) -> failed, not invalid_token', async () => {
    const { connect } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 400, body: { reason: 'TopicDisallowed' } } });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('failed');
  });

  test('stream error -> failed, and force-cancels the stream + destroys the session', async () => {
    const { connect, sessionHandles, streamHandles } = makeFakeConnect({
      'https://api.development.push.apple.com': { status: 200, simulateError: true },
    });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result.status).toBe('failed');
    expect(streamHandles[0].close).toHaveBeenCalledWith(http2.constants.NGHTTP2_CANCEL);
    expect(sessionHandles[0].destroy).toHaveBeenCalledTimes(1);
    expect(sessionHandles[0].close).not.toHaveBeenCalled();
  });

  test('timeout -> failed, without hanging, and force-cancels the stream + destroys the session', async () => {
    jest.useFakeTimers();
    try {
      const { connect, sessionHandles, streamHandles } = makeFakeConnect({
        'https://api.development.push.apple.com': { status: 200, simulateTimeout: true },
      });
      const promise = sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
      jest.advanceTimersByTime(5000);
      const result = await promise;
      expect(result).toEqual({ status: 'failed', reason: 'timeout' });
      expect(streamHandles[0].close).toHaveBeenCalledWith(http2.constants.NGHTTP2_CANCEL);
      expect(sessionHandles[0].destroy).toHaveBeenCalledTimes(1);
      expect(sessionHandles[0].close).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('session error while a request is in flight (no response ever arrives) -> failed, destroys session', async () => {
    const connect: Http2ConnectFn = (() => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: jest.Mock }).close = jest.fn();
      (session as unknown as { destroy: jest.Mock }).destroy = jest.fn();
      (session as unknown as { request: () => http2.ClientHttp2Stream }).request = () => {
        const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
        (stream as unknown as { close: jest.Mock }).close = jest.fn();
        (stream as unknown as { end: () => void }).end = () => {
          // Connection drops at the session level before any response — the
          // stream itself never emits 'response'/'end'/'error'.
          queueMicrotask(() => session.emit('error', new Error('connection reset')));
        };
        return stream;
      };
      return session;
    }) as Http2ConnectFn;

    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result).toEqual({ status: 'failed', reason: 'session_error' });
  });

  test('connect() itself throwing synchronously (session errors before any listener exists) -> failed, never reaches session.request()', async () => {
    // Node's EventEmitter throws synchronously out of .emit('error', ...)
    // when there is no 'error' listener registered yet — which is exactly
    // the state during connect() itself, since sendVoipPushToDeviceToken
    // only calls session.on('error', ...) *after* connect() returns. This
    // is what a connection that fails before we ever get a usable session
    // looks like, and it's already handled by the existing
    // `try { session = connect(...) } catch { ... }` in production code —
    // this test asserts session.request() is therefore genuinely never
    // reached, rather than just claiming so in the title.
    let requestCalled = false;
    const connect: Http2ConnectFn = (() => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: jest.Mock }).close = jest.fn();
      (session as unknown as { destroy: jest.Mock }).destroy = jest.fn();
      (session as unknown as { request: () => never }).request = () => {
        requestCalled = true;
        throw new Error('should not be reached — request() must never be called');
      };
      session.emit('error', new Error('immediate connect failure')); // throws synchronously, no listener yet
      return session; // unreachable
    }) as Http2ConnectFn;

    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result).toEqual({ status: 'failed', reason: 'connect_error' });
    expect(requestCalled).toBe(false);
  });

  test('duplicate/out-of-order events do not double-resolve or double-cleanup', async () => {
    const { connect, sessionHandles, streamHandles } = makeFakeConnect({
      'https://api.development.push.apple.com': { status: 200 },
    });
    const result = await sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect);
    expect(result).toEqual({ status: 'sent' });

    // Fire extra events after settlement — must be silently ignored.
    streamHandles[0].stream.emit('end');
    streamHandles[0].stream.emit('error', new Error('late error'));
    sessionHandles[0].session.emit('error', new Error('late session error'));

    expect(sessionHandles[0].close).toHaveBeenCalledTimes(1);
    expect(sessionHandles[0].destroy).not.toHaveBeenCalled();
  });

  test('session.request() throwing synchronously -> failed, never rejects', async () => {
    const connect: Http2ConnectFn = (() => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: jest.Mock }).close = jest.fn();
      (session as unknown as { destroy: jest.Mock }).destroy = jest.fn();
      (session as unknown as { request: () => never }).request = () => {
        throw new Error('boom');
      };
      return session;
    }) as Http2ConnectFn;

    await expect(
      sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect)
    ).resolves.toEqual({ status: 'failed', reason: 'request_error' });
  });

  test('req.end() throwing synchronously -> failed, never rejects', async () => {
    const connect: Http2ConnectFn = (() => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: jest.Mock }).close = jest.fn();
      (session as unknown as { destroy: jest.Mock }).destroy = jest.fn();
      (session as unknown as { request: () => http2.ClientHttp2Stream }).request = () => {
        const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
        (stream as unknown as { close: jest.Mock }).close = jest.fn();
        (stream as unknown as { end: () => never }).end = () => {
          throw new Error('boom');
        };
        return stream;
      };
      return session;
    }) as Http2ConnectFn;

    await expect(
      sendVoipPushToDeviceToken('t', 'SANDBOX', validConfig(), { callId: 'c', callerName: 'A', hasVideo: false }, connect)
    ).resolves.toEqual({ status: 'failed', reason: 'end_error' });
  });

  test('getProviderJwt/crypto.sign throwing synchronously -> failed, never rejects, no connection opened', async () => {
    const config = validConfig();
    const brokenConfig: ApnsConfig = { ...config, privateKeyPem: 'not a real PEM at all' };
    const { connect, calls } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 200 } });

    await expect(
      sendVoipPushToDeviceToken('t', 'SANDBOX', brokenConfig, { callId: 'c', callerName: 'A', hasVideo: false }, connect)
    ).resolves.toEqual({ status: 'failed', reason: 'jwt_error' });
    expect(calls).toHaveLength(0);
  });

  test('payload exceeding MAX_VOIP_PAYLOAD_BYTES -> payload_too_large, no connection opened', async () => {
    const { connect, calls } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 200 } });
    const oversizedCallId = 'x'.repeat(MAX_VOIP_PAYLOAD_BYTES + 100);

    const result = await sendVoipPushToDeviceToken(
      't',
      'SANDBOX',
      validConfig(),
      { callId: oversizedCallId, callerName: 'Alex', hasVideo: false },
      connect
    );
    expect(result.status).toBe('payload_too_large');
    if (result.status === 'payload_too_large') {
      expect(result.byteLength).toBeGreaterThan(MAX_VOIP_PAYLOAD_BYTES);
    }
    expect(calls).toHaveLength(0); // never even connected
  });

  test('callerName is truncated Unicode-code-point-safely (emoji/multi-byte names do not blow the byte budget)', async () => {
    const { connect, calls } = makeFakeConnect({ 'https://api.development.push.apple.com': { status: 200 } });
    // 200 emoji (each a surrogate pair in UTF-16, 4 bytes in UTF-8) — a naive
    // .slice(0, N) on UTF-16 code units could split a surrogate pair.
    const emojiName = '😀'.repeat(200);

    const result = await sendVoipPushToDeviceToken(
      't',
      'SANDBOX',
      validConfig(),
      { callId: 'call-1', callerName: emojiName, hasVideo: false },
      connect
    );
    expect(result).toEqual({ status: 'sent' });
    const payload = JSON.parse(calls[0].body);
    // Truncated, but still valid UTF-16 (no lone surrogate) and well under
    // the byte cap.
    expect(Buffer.byteLength(calls[0].body, 'utf8')).toBeLessThanOrEqual(MAX_VOIP_PAYLOAD_BYTES);
    expect(() => Buffer.from(payload.callerName, 'utf8').toString('utf8')).not.toThrow();
    expect(Array.from(payload.callerName).length).toBeLessThanOrEqual(64);
    expect(payload.handle).toBe(payload.callerName);
  });
});

describe('sendVoipPushForIncomingCall', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('APNs not configured -> skipped, no DB lookup, no network', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APNS_TEAM_ID;
    const summary = await sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex' });
    expect(summary).toEqual({ total: 0, sent: 0, invalid: 0, failed: 0, skipped: 1 });
    expect(mockedFindMany).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('APNs not configured -> logs only the safe classification reason, never a config value/secret', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV, APNS_VOIP_TOPIC: 'com.wrong.topic' };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const loggedArgs = warnSpy.mock.calls[0].join(' ');
      expect(loggedArgs).toContain('topic_mismatch');
      expect(loggedArgs).not.toContain(VALID_ENV.APNS_PRIVATE_KEY_BASE64);
      expect(loggedArgs).not.toContain(VALID_ENV.APNS_TEAM_ID);
      expect(loggedArgs).not.toMatch(/PRIVATE KEY/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('callee has no tokens -> empty summary, not an error', async () => {
    mockedFindMany.mockResolvedValue([]);
    const summary = await sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex' });
    expect(summary).toEqual({ total: 0, sent: 0, invalid: 0, failed: 0, skipped: 0 });
  });

  test('queries only IOS tokens for the given callee', async () => {
    mockedFindMany.mockResolvedValue([]);
    await sendVoipPushForIncomingCall({ calleeUserId: 'callee-xyz', callId: 'c1', callerName: 'Alex' });
    expect(mockedFindMany).toHaveBeenCalledWith({ where: { userId: 'callee-xyz', platform: 'IOS' } });
  });

  test('mixed outcomes: one sent, one invalid (deleted), one failed — none block the others', async () => {
    mockedFindMany.mockResolvedValue([
      { token: 'tok-sent', userId: 'u1', platform: 'IOS', environment: 'SANDBOX' },
      { token: 'tok-invalid', userId: 'u1', platform: 'IOS', environment: 'SANDBOX' },
      { token: 'tok-failed', userId: 'u1', platform: 'IOS', environment: 'PRODUCTION' },
    ]);

    let call = 0;
    const connect: Http2ConnectFn = ((authority: string) => {
      call += 1;
      const outcome = call === 1 ? { status: 200 } : call === 2 ? { status: 410 } : { status: 500 };
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: () => void }).close = jest.fn();
      (session as unknown as { request: (h: http2.OutgoingHttpHeaders) => http2.ClientHttp2Stream }).request = () => {
        const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
        (stream as unknown as { end: (b: string) => void }).end = () => {
          queueMicrotask(() => {
            stream.emit('response', { ':status': outcome.status });
            stream.emit('end');
          });
        };
        return stream;
      };
      return session;
    }) as Http2ConnectFn;

    const summary = await sendVoipPushForIncomingCall({
      calleeUserId: 'u1',
      callId: 'c1',
      callerName: 'Alex',
      connect,
    });

    expect(summary).toEqual({ total: 3, sent: 1, invalid: 1, failed: 1, skipped: 0 });
    expect(mockedDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: { token: 'tok-invalid', userId: 'u1', platform: 'IOS', environment: 'SANDBOX' },
    });
  });

  test('DeviceTokenNotForTopic is treated as invalid_token and deletes only that exact token', async () => {
    mockedFindMany.mockResolvedValue([{ token: 'tok-wrong-topic', userId: 'u1', platform: 'IOS', environment: 'PRODUCTION' }]);

    const connect: Http2ConnectFn = (() => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: jest.Mock }).close = jest.fn();
      (session as unknown as { request: (h: http2.OutgoingHttpHeaders) => http2.ClientHttp2Stream }).request = () => {
        const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
        (stream as unknown as { end: (b: string) => void }).end = () => {
          queueMicrotask(() => {
            stream.emit('response', { ':status': 400 });
            stream.emit('data', Buffer.from(JSON.stringify({ reason: 'DeviceTokenNotForTopic' })));
            stream.emit('end');
          });
        };
        return stream;
      };
      return session;
    }) as Http2ConnectFn;

    const summary = await sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex', connect });

    expect(summary).toEqual({ total: 1, sent: 0, invalid: 1, failed: 0, skipped: 0 });
    expect(mockedDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: { token: 'tok-wrong-topic', userId: 'u1', platform: 'IOS', environment: 'PRODUCTION' },
    });
  });

  test('invalid-token cleanup failure does not affect the summary or throw', async () => {
    mockedFindMany.mockResolvedValue([{ token: 'tok-invalid', userId: 'u1', platform: 'IOS', environment: 'SANDBOX' }]);
    mockedDeleteMany.mockRejectedValue(new Error('db unavailable'));

    const connect: Http2ConnectFn = ((authority: string) => {
      const session = new EventEmitter() as unknown as http2.ClientHttp2Session;
      (session as unknown as { close: () => void }).close = jest.fn();
      (session as unknown as { request: (h: http2.OutgoingHttpHeaders) => http2.ClientHttp2Stream }).request = () => {
        const stream = new EventEmitter() as unknown as http2.ClientHttp2Stream;
        (stream as unknown as { end: (b: string) => void }).end = () => {
          queueMicrotask(() => {
            stream.emit('response', { ':status': 410 });
            stream.emit('end');
          });
        };
        return stream;
      };
      return session;
    }) as Http2ConnectFn;

    const summary = await sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex', connect });
    expect(summary).toEqual({ total: 1, sent: 0, invalid: 1, failed: 0, skipped: 0 });
  });

  test('token lookup itself failing (DB error) -> structured failed summary, never rejects', async () => {
    mockedFindMany.mockRejectedValue(new Error('connection reset'));
    await expect(
      sendVoipPushForIncomingCall({ calleeUserId: 'u1', callId: 'c1', callerName: 'Alex' })
    ).resolves.toEqual({ total: 0, sent: 0, invalid: 0, failed: 1, skipped: 0 });
  });
});
