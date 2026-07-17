import http2 from 'node:http2';
import crypto from 'node:crypto';
import { ApnsEnvironment } from '@prisma/client';
import { prisma } from './prisma';

// APNs HTTP/2 VoIP Push sender (private 1:1 voice calling — phase 3, see
// docs/private-voice-calling-spec.md "iOS 原生能力"). Node built-ins only
// (node:http2 + node:crypto) — no APNs/JWT third-party dependency.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  voipTopic: string;
};

export type ApnsConfigResult =
  | { ok: true; config: ApnsConfig }
  | {
      ok: false;
      reason:
        | 'missing_config'
        | 'invalid_private_key_base64'
        | 'invalid_private_key_pem'
        | 'unsupported_key_type'
        | 'unsupported_key_curve'
        | 'topic_mismatch';
    };

const BASE64_CHARSET_RE = /^[A-Za-z0-9+/=\s]+$/;

// APNs' ES256 requires a NIST P-256 EC key. Node reports this curve's
// namedCurve as 'prime256v1' (confirmed against a real generated P-256
// keypair) — not 'P-256' or 'secp256r1', which are OpenSSL/other-library
// aliases Node's crypto module does not use for this field.
const APNS_REQUIRED_EC_CURVE = 'prime256v1';

// Reads config lazily (never at module import time) so the backend can start
// with no APNs secrets configured at all — a missing/invalid config is a
// normal `{ ok: false }` result, not a thrown error.
export function loadApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfigResult {
  const teamId = env.APNS_TEAM_ID;
  const keyId = env.APNS_KEY_ID;
  const privateKeyBase64 = env.APNS_PRIVATE_KEY_BASE64;
  const bundleId = env.APNS_BUNDLE_ID;
  const voipTopic = env.APNS_VOIP_TOPIC;

  if (!teamId || !keyId || !privateKeyBase64 || !bundleId || !voipTopic) {
    return { ok: false, reason: 'missing_config' };
  }

  if (!BASE64_CHARSET_RE.test(privateKeyBase64)) {
    return { ok: false, reason: 'invalid_private_key_base64' };
  }

  const privateKeyPem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
  if (!privateKeyPem.includes('PRIVATE KEY')) {
    return { ok: false, reason: 'invalid_private_key_base64' };
  }

  let keyObject: crypto.KeyObject;
  try {
    keyObject = crypto.createPrivateKey(privateKeyPem);
  } catch {
    return { ok: false, reason: 'invalid_private_key_pem' };
  }

  // Never log/return `keyObject` or `privateKeyPem` itself past this point —
  // only the type/curve classification.
  if (keyObject.asymmetricKeyType !== 'ec') {
    return { ok: false, reason: 'unsupported_key_type' };
  }
  if (keyObject.asymmetricKeyDetails?.namedCurve !== APNS_REQUIRED_EC_CURVE) {
    return { ok: false, reason: 'unsupported_key_curve' };
  }

  if (voipTopic !== `${bundleId}.voip`) {
    return { ok: false, reason: 'topic_mismatch' };
  }

  return { ok: true, config: { teamId, keyId, privateKeyPem, bundleId, voipTopic } };
}

// ---------------------------------------------------------------------------
// APNs provider JWT (ES256, IEEE-P1363 raw R||S signature)
// ---------------------------------------------------------------------------

// Apple allows provider tokens up to ~60 minutes old; refresh at 50 to stay
// well clear of that boundary.
const JWT_REFRESH_THRESHOLD_SECONDS = 50 * 60;

type JwtCacheEntry = { token: string; iat: number; fingerprint: string };
let jwtCache: JwtCacheEntry | null = null;

function configFingerprint(config: ApnsConfig): string {
  return crypto
    .createHash('sha256')
    .update(`${config.teamId}:${config.keyId}:${config.privateKeyPem}`)
    .digest('hex');
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// `nowSeconds` is injectable so tests can exercise cache-refresh boundaries
// without waiting on real time. Throws only if `crypto.sign` itself throws
// (e.g. a corrupt key slipping past loadApnsConfig's validation) — callers
// that need a never-throws guarantee (sendVoipPushToDeviceToken) wrap this.
export function getProviderJwt(config: ApnsConfig, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const fingerprint = configFingerprint(config);
  if (jwtCache && jwtCache.fingerprint === fingerprint && nowSeconds - jwtCache.iat < JWT_REFRESH_THRESHOLD_SECONDS) {
    return jwtCache.token;
  }

  const header = { alg: 'ES256', kid: config.keyId };
  const claims = { iss: config.teamId, iat: nowSeconds };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  // dsaEncoding: 'ieee-p1363' produces the raw 64-byte R||S signature APNs
  // requires — Node's default ('der') would produce a DER-wrapped signature
  // of varying length, which Apple rejects.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: config.privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });

  const token = `${signingInput}.${base64url(signature)}`;
  jwtCache = { token, iat: nowSeconds, fingerprint };
  return token;
}

// Test-only: clears the module-level JWT cache between test cases.
export function resetApnsJwtCacheForTesting(): void {
  jwtCache = null;
}

// ---------------------------------------------------------------------------
// HTTP/2 send
// ---------------------------------------------------------------------------

const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  SANDBOX: 'https://api.development.push.apple.com',
  PRODUCTION: 'https://api.push.apple.com',
};

const REQUEST_TIMEOUT_MS = 5000;

// APNs' documented VoIP/notification payload limit. Checked against the
// final serialized+truncated body, not estimated ahead of time.
export const MAX_VOIP_PAYLOAD_BYTES = 5120;

// Display-length cap on callerName — generous for any real name, and keeps
// the payload far under MAX_VOIP_PAYLOAD_BYTES on its own. Array.from splits
// on Unicode code points (not UTF-16 code units), so this never cuts a
// surrogate pair (e.g. an emoji) in half the way a naive `.slice()` could.
export const MAX_CALLER_NAME_DISPLAY_CHARS = 64;

function truncateCallerName(name: string): string {
  const codePoints = Array.from(name);
  if (codePoints.length <= MAX_CALLER_NAME_DISPLAY_CHARS) return name;
  return codePoints.slice(0, MAX_CALLER_NAME_DISPLAY_CHARS).join('');
}

export type VoipPushPayload = {
  callId: string;
  callerName: string;
  hasVideo: boolean;
};

export type SendResult =
  | { status: 'sent' }
  | { status: 'invalid_token'; httpStatus?: number; reason?: string }
  | { status: 'payload_too_large'; byteLength: number }
  | { status: 'failed'; httpStatus?: number; reason?: string };

export type Http2ConnectFn = typeof http2.connect;

// Sends a single VoIP push to a single device token over HTTP/2. Never
// rejects/throws — every synchronous step (payload build, JWT signing,
// connect, request, end) and every asynchronous failure (timeout, session
// error, stream error) resolves to a structured `SendResult` instead.
export function sendVoipPushToDeviceToken(
  deviceToken: string,
  environment: ApnsEnvironment,
  config: ApnsConfig,
  payload: VoipPushPayload,
  connect: Http2ConnectFn = http2.connect
): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let req: http2.ClientHttp2Stream | undefined;
    let session: ReturnType<Http2ConnectFn> | undefined;

    // Reached on a clean, fully-read response: let HTTP/2 close the session
    // gracefully (any keep-alive semantics are irrelevant here since we
    // never reuse a session across sends).
    const finishGraceful = (result: SendResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        session?.close();
      } catch {
        // already closed/closing — nothing to do
      }
      resolve(result);
    };

    // Reached on timeout, session/stream error, or a synchronous throw
    // partway through: cancel any in-flight stream and force the connection
    // closed rather than waiting on graceful shutdown that may never come.
    const finishForced = (result: SendResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        req?.close(http2.constants.NGHTTP2_CANCEL);
      } catch {
        // stream already closed/destroyed — nothing to do
      }
      try {
        session?.destroy();
      } catch {
        // session already destroyed — nothing to do
      }
      resolve(result);
    };

    // --- Synchronous prep, before any I/O: payload size, then JWT signing.
    // An oversized payload or a signing failure means no connection is ever
    // opened at all.
    let body: string;
    try {
      // Per docs/private-voice-calling-spec.md's exact payload shape:
      // { aps, uuid, callId, callerName, handle, hasVideo }. `uuid` and
      // `callId` are both `Call.id` (CallKit UUID = Call.id); `handle` and
      // `callerName` are the same truncated display name — no token, user
      // id, photo, or other profile data.
      const truncatedCallerName = truncateCallerName(payload.callerName);
      body = JSON.stringify({
        aps: {},
        uuid: payload.callId,
        callId: payload.callId,
        callerName: truncatedCallerName,
        handle: truncatedCallerName,
        hasVideo: payload.hasVideo,
      });
    } catch {
      resolve({ status: 'failed', reason: 'payload_build_error' });
      return;
    }

    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > MAX_VOIP_PAYLOAD_BYTES) {
      resolve({ status: 'payload_too_large', byteLength: bodyBytes });
      return;
    }

    let jwt: string;
    try {
      jwt = getProviderJwt(config);
    } catch {
      resolve({ status: 'failed', reason: 'jwt_error' });
      return;
    }

    try {
      session = connect(APNS_HOSTS[environment]);
    } catch {
      resolve({ status: 'failed', reason: 'connect_error' });
      return;
    }

    timer = setTimeout(() => finishForced({ status: 'failed', reason: 'timeout' }), REQUEST_TIMEOUT_MS);
    session.on('error', () => finishForced({ status: 'failed', reason: 'session_error' }));

    try {
      req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${jwt}`,
        'apns-push-type': 'voip',
        'apns-topic': config.voipTopic,
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 45),
        'content-type': 'application/json',
      });
    } catch {
      finishForced({ status: 'failed', reason: 'request_error' });
      return;
    }

    let statusCode: number | undefined;
    let responseBody = '';

    req.on('response', (headers) => {
      const raw = headers[':status'];
      statusCode = typeof raw === 'number' ? raw : Number(raw);
    });
    req.on('data', (chunk) => {
      responseBody += chunk;
    });
    req.on('end', () => {
      if (statusCode === 200) {
        finishGraceful({ status: 'sent' });
        return;
      }

      let reason: string | undefined;
      try {
        const parsed = responseBody ? JSON.parse(responseBody) : undefined;
        reason = parsed?.reason;
      } catch {
        reason = undefined;
      }

      if (
        statusCode === 410 ||
        reason === 'Unregistered' ||
        reason === 'BadDeviceToken' ||
        reason === 'DeviceTokenNotForTopic'
      ) {
        finishGraceful({ status: 'invalid_token', httpStatus: statusCode, reason });
        return;
      }

      finishGraceful({ status: 'failed', httpStatus: statusCode, reason });
    });
    req.on('error', () => finishForced({ status: 'failed', reason: 'stream_error' }));

    try {
      req.end(body);
    } catch {
      finishForced({ status: 'failed', reason: 'end_error' });
    }
  });
}

// ---------------------------------------------------------------------------
// Multi-device fan-out + invalid-token cleanup
// ---------------------------------------------------------------------------

export type SendVoipPushSummary = {
  total: number;
  sent: number;
  invalid: number;
  failed: number;
  skipped: number;
};

const EMPTY_SUMMARY: SendVoipPushSummary = { total: 0, sent: 0, invalid: 0, failed: 0, skipped: 0 };

// High-level entry point: looks up the callee's registered iOS VoIP tokens,
// sends to each in parallel (one token failing never affects another), and
// deletes only the exact tokens APNs confirmed are invalid. Never
// throws/rejects — including if the initial token lookup itself fails —
// so callers (startCall) can safely await this as a best-effort side effect.
export async function sendVoipPushForIncomingCall(params: {
  calleeUserId: string;
  callId: string;
  callerName: string;
  connect?: Http2ConnectFn;
}): Promise<SendVoipPushSummary> {
  const configResult = loadApnsConfig();
  if (!configResult.ok) {
    // Safe to log: `reason` is one of a fixed set of classification labels
    // (e.g. 'missing_config'/'topic_mismatch') — never a config value, key,
    // or secret.
    console.warn(`[apnsVoip] send skipped — APNs not configured (${configResult.reason})`);
    return { ...EMPTY_SUMMARY, skipped: 1 };
  }

  let tokens: Awaited<ReturnType<typeof prisma.voipDeviceToken.findMany>>;
  try {
    tokens = await prisma.voipDeviceToken.findMany({
      where: { userId: params.calleeUserId, platform: 'IOS' },
    });
  } catch {
    // Lookup itself failed (DB error) — report as a single aggregate
    // failure rather than letting the rejection propagate to startCall.
    return { ...EMPTY_SUMMARY, failed: 1 };
  }

  if (tokens.length === 0) {
    return EMPTY_SUMMARY;
  }

  const results = await Promise.allSettled(
    tokens.map((deviceToken) =>
      sendVoipPushToDeviceToken(
        deviceToken.token,
        deviceToken.environment,
        configResult.config,
        { callId: params.callId, callerName: params.callerName, hasVideo: false },
        params.connect
      )
    )
  );

  const summary: SendVoipPushSummary = { total: tokens.length, sent: 0, invalid: 0, failed: 0, skipped: 0 };
  const invalidTokens: (typeof tokens)[number][] = [];

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      summary.failed += 1;
      return;
    }
    if (result.value.status === 'sent') {
      summary.sent += 1;
    } else if (result.value.status === 'invalid_token') {
      summary.invalid += 1;
      invalidTokens.push(tokens[index]);
    } else {
      // 'failed' or 'payload_too_large'
      summary.failed += 1;
    }
  });

  if (invalidTokens.length > 0) {
    await Promise.allSettled(
      invalidTokens.map((deviceToken) =>
        prisma.voipDeviceToken
          .deleteMany({
            where: {
              token: deviceToken.token,
              userId: deviceToken.userId,
              platform: deviceToken.platform,
              environment: deviceToken.environment,
            },
          })
          .catch(() => null)
      )
    );
  }

  return summary;
}
