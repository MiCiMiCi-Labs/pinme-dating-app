// Plain Node script (no test framework) verifying nativeCallIntentQueue.ts's
// pure functions. Run from apps/mobile (PowerShell — Windows PowerShell 5.1
// has no inline VAR=value syntax, so the env vars are set as separate
// statements first):
//
//   cd apps/mobile
//   $env:TS_NODE_TRANSPILE_ONLY='true'
//   $env:TS_NODE_SKIP_PROJECT='true'
//   $env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
//   node -r ts-node/register lib/nativeCallIntentQueue.test.js
//
// (bash/zsh equivalent: TS_NODE_TRANSPILE_ONLY=true TS_NODE_SKIP_PROJECT=true
// TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
// node -r ts-node/register lib/nativeCallIntentQueue.test.js)
//
// TS_NODE_SKIP_PROJECT is the load-bearing flag: without it, ts-node picks
// up this package's own tsconfig.json (which extends expo/tsconfig.base),
// whose bundler-oriented moduleResolution/customConditions settings conflict
// with the CommonJS output ts-node needs to produce for a plain `node -r`
// require() — skipping the project file entirely and supplying the minimal
// CommonJS/Node options above avoids that fight. ts-node is already an
// existing hoisted devDependency in this monorepo — nothing new installed
// for this test, and tsc --noEmit (run separately) is what actually
// type-checks this file; TS_NODE_TRANSPILE_ONLY here skips type-checking
// during the test run itself.

const assert = require('node:assert');
const {
  isValidCallId,
  extractIncomingCallId,
  isEntryExpired,
  resolveExpiredIncomingDisposition,
  enqueueDeduped,
  removeEntriesForCallId,
  retryBackoffMs,
  decideAuthIdentityTransition,
  resolveAnswerConfirmation,
  resolveEndConfirmation,
  shouldRescheduleDrainAfterExit,
  MAX_QUEUE_LENGTH,
  ENTRY_TTL_MS,
  RETRY_BACKOFF_MS,
} = require('./nativeCallIntentQueue.ts');

function testIsValidCallId() {
  assert.strictEqual(isValidCallId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.strictEqual(isValidCallId('550E8400-E29B-41D4-A716-446655440000'), true, 'case-insensitive');
  assert.strictEqual(isValidCallId(''), false);
  assert.strictEqual(isValidCallId('not-a-uuid'), false);
  assert.strictEqual(isValidCallId(undefined), false);
  assert.strictEqual(isValidCallId(null), false);
  assert.strictEqual(isValidCallId(12345), false);
  assert.strictEqual(isValidCallId('550e8400-e29b-41d4-a716-44665544000'), false, 'too short');
}

function testExtractIncomingCallId() {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  // Both present and matching -> accepted.
  assert.strictEqual(extractIncomingCallId({ uuid, callId: uuid }), uuid);

  // Both present but disagreeing -> discarded (null), never guess.
  assert.strictEqual(
    extractIncomingCallId({ uuid, callId: '11111111-1111-1111-1111-111111111111' }),
    null
  );

  // Only one present -> accepted if valid.
  assert.strictEqual(extractIncomingCallId({ uuid }), uuid);
  assert.strictEqual(extractIncomingCallId({ callId: uuid }), uuid);

  // Invalid formats -> null.
  assert.strictEqual(extractIncomingCallId({ uuid: 'garbage' }), null);
  assert.strictEqual(extractIncomingCallId({}), null);
  assert.strictEqual(extractIncomingCallId(null), null);
  assert.strictEqual(extractIncomingCallId('a string, not an object'), null);

  // callerName/handle must never influence extraction — not even present
  // in the function's inputs, but double-check extra fields are ignored.
  assert.strictEqual(
    extractIncomingCallId({ uuid, callId: uuid, callerName: 'Attacker', handle: 'evil' }),
    uuid
  );
}

function testIsEntryExpired() {
  const now = 1_000_000;
  const fresh = { type: 'incoming', callId: 'x', enqueuedAt: now - 1000 };
  const stale = { type: 'incoming', callId: 'x', enqueuedAt: now - (ENTRY_TTL_MS + 1) };
  assert.strictEqual(isEntryExpired(fresh, now), false);
  assert.strictEqual(isEntryExpired(stale, now), true);

  // answer/end are user actions that already happened — they must never be
  // silently TTL-dropped, no matter how long they've been queued (bounded
  // only by MAX_QUEUE_LENGTH/generation invalidation elsewhere).
  const staleAnswer = { type: 'answer', callId: 'x', enqueuedAt: now - (ENTRY_TTL_MS + 1) };
  const staleEnd = { type: 'end', callId: 'x', enqueuedAt: now - (ENTRY_TTL_MS + 1) };
  assert.strictEqual(isEntryExpired(staleAnswer, now), false, 'answer must never TTL-expire');
  assert.strictEqual(isEntryExpired(staleEnd, now), false, 'end must never TTL-expire');
  // Even absurdly old.
  const ancientAnswer = { type: 'answer', callId: 'x', enqueuedAt: 0 };
  assert.strictEqual(isEntryExpired(ancientAnswer, now), false);
}

function testResolveExpiredIncomingDisposition() {
  const expiredIncoming = { type: 'incoming', callId: 'call-1', enqueuedAt: 0 };

  // No following action for the same callId -> safe to close stale CallKit.
  assert.strictEqual(resolveExpiredIncomingDisposition([], expiredIncoming), 'close-stale-callkit');
  assert.strictEqual(
    resolveExpiredIncomingDisposition(
      [{ type: 'incoming', callId: 'call-2', enqueuedAt: 1 }],
      expiredIncoming
    ),
    'close-stale-callkit',
    'an unrelated callId does not count as a following action'
  );

  // A queued 'answer' for the SAME callId -> must not tear down the call the
  // answer is about to act on.
  assert.strictEqual(
    resolveExpiredIncomingDisposition(
      [{ type: 'answer', callId: 'call-1', enqueuedAt: 1 }],
      expiredIncoming
    ),
    'silent-drop'
  );

  // A queued 'end' for the SAME callId -> same reasoning.
  assert.strictEqual(
    resolveExpiredIncomingDisposition(
      [{ type: 'end', callId: 'call-1', enqueuedAt: 1 }],
      expiredIncoming
    ),
    'silent-drop'
  );
}

function testEnqueueDedupedBasics() {
  const e1 = { type: 'incoming', callId: 'call-1', enqueuedAt: 1 };
  const e2 = { type: 'answer', callId: 'call-1', enqueuedAt: 2 };
  let queue = [];
  queue = enqueueDeduped(queue, e1);
  queue = enqueueDeduped(queue, e2);
  assert.deepStrictEqual(queue, [e1, e2], 'answer and incoming for the same call must not dedup against each other');

  // Same callId + same type -> dedup, replacing at the back with the newer entry.
  const e1b = { type: 'incoming', callId: 'call-1', enqueuedAt: 3 };
  queue = enqueueDeduped(queue, e1b);
  assert.deepStrictEqual(queue, [e2, e1b], 'duplicate (callId, type) must replace, moving to the back');

  // answer vs end are different types -> both retained.
  const e3 = { type: 'end', callId: 'call-1', enqueuedAt: 4 };
  queue = enqueueDeduped(queue, e3);
  assert.deepStrictEqual(queue, [e2, e1b, e3]);
}

function testEnqueueDedupedCap() {
  let queue = [];
  const maxLength = 3;
  for (let i = 0; i < 5; i++) {
    queue = enqueueDeduped(queue, { type: 'incoming', callId: `call-${i}`, enqueuedAt: i }, maxLength);
  }
  assert.strictEqual(queue.length, maxLength, 'queue must never exceed maxLength');
  // Oldest (call-0, call-1) must have been dropped; most recent retained.
  assert.deepStrictEqual(
    queue.map(e => e.callId),
    ['call-2', 'call-3', 'call-4']
  );
}

function testRemoveEntriesForCallId() {
  const queue = [
    { type: 'incoming', callId: 'a', enqueuedAt: 1 },
    { type: 'answer', callId: 'a', enqueuedAt: 2 },
    { type: 'end', callId: 'b', enqueuedAt: 3 },
  ];
  const result = removeEntriesForCallId(queue, 'a');
  assert.deepStrictEqual(result, [{ type: 'end', callId: 'b', enqueuedAt: 3 }]);
}

function testRetryBackoffMs() {
  assert.strictEqual(retryBackoffMs(0), RETRY_BACKOFF_MS[0]);
  assert.strictEqual(retryBackoffMs(1), RETRY_BACKOFF_MS[1]);
  assert.ok(retryBackoffMs(0) > 0, 'must never be a 0ms tight loop');
  // Capped: absurdly high attempt counts must not throw or grow unbounded.
  assert.strictEqual(retryBackoffMs(999), RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  assert.strictEqual(retryBackoffMs(-5), RETRY_BACKOFF_MS[0]);
}

function testDecideAuthIdentityTransition() {
  // Still loading (cold start, session not yet restored) -> wait, no matter
  // what the (irrelevant) previous/current identity fields say.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: false, previousAuthUserId: null, authLoading: true, authUserId: null }),
    { action: 'wait' }
  );

  // First-ever resolution (authInitialized: false) landing on a real user
  // ("unknown -> A") must be 'baseline', NEVER 'invalidate' — this is
  // exactly the cold-start race that used to wipe the pending queue.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: false, previousAuthUserId: null, authLoading: false, authUserId: 'A' }),
    { action: 'baseline', authUserId: 'A' }
  );
  // Same for "unknown -> logged out" (a restored session that turned out to
  // be empty) — also just a baseline, not an invalidation.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: false, previousAuthUserId: null, authLoading: false, authUserId: null }),
    { action: 'baseline', authUserId: null }
  );

  // Post-initialization, unchanged identity -> noop.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: true, previousAuthUserId: 'A', authLoading: false, authUserId: 'A' }),
    { action: 'noop' }
  );

  // Post-initialization A -> logout.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: true, previousAuthUserId: 'A', authLoading: false, authUserId: null }),
    { action: 'invalidate', authUserId: null }
  );
  // Post-initialization A -> B.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: true, previousAuthUserId: 'A', authLoading: false, authUserId: 'B' }),
    { action: 'invalidate', authUserId: 'B' }
  );
  // Post-initialization logout -> B.
  assert.deepStrictEqual(
    decideAuthIdentityTransition({ authInitialized: true, previousAuthUserId: null, authLoading: false, authUserId: 'B' }),
    { action: 'invalidate', authUserId: 'B' }
  );
}

function testResolveAnswerConfirmation() {
  // Server confirms ACCEPTED -> handled.
  assert.strictEqual(
    resolveAnswerConfirmation({ networkError: false, serverConfirmsAccepted: true, serverIsTerminal: false }),
    'handled'
  );
  // Server shows a terminal status instead (accept never landed, call ended
  // some other way) -> handled (nothing left to retry).
  assert.strictEqual(
    resolveAnswerConfirmation({ networkError: false, serverConfirmsAccepted: false, serverIsTerminal: true }),
    'handled'
  );
  // Still RINGING -> retry (accept never landed, safe to re-send).
  assert.strictEqual(
    resolveAnswerConfirmation({ networkError: false, serverConfirmsAccepted: false, serverIsTerminal: false }),
    'retry'
  );
  // The confirmation GET itself failed (on top of whatever acceptCallAction
  // internally already went through) -> retry, never handled.
  assert.strictEqual(resolveAnswerConfirmation({ networkError: true }), 'retry');
}

function testResolveEndConfirmation() {
  // Server confirms a terminal status -> handled.
  assert.strictEqual(resolveEndConfirmation({ networkError: false, serverIsTerminal: true }), 'handled');
  // Still RINGING/ACCEPTED -> retry (decline/cancel/end never landed).
  assert.strictEqual(resolveEndConfirmation({ networkError: false, serverIsTerminal: false }), 'retry');
  // The confirmation GET itself failed -> retry, never handled.
  assert.strictEqual(resolveEndConfirmation({ networkError: true }), 'retry');
}

function testShouldRescheduleDrainAfterExit() {
  // Nothing left to drain -> never reschedule regardless of the other flags.
  assert.strictEqual(
    shouldRescheduleDrainAfterExit({ queueLength: 0, hasAccessToken: true, hasScheduledTimer: false }),
    false
  );
  // Logged out (no access token) -> must not keep scheduling drains that
  // can only no-op.
  assert.strictEqual(
    shouldRescheduleDrainAfterExit({ queueLength: 2, hasAccessToken: false, hasScheduledTimer: false }),
    false
  );
  // A drain is already scheduled (e.g. a 'retry' backoff, or a fresh enqueue
  // that landed after drainingRef cleared) -> do not schedule a second one.
  assert.strictEqual(
    shouldRescheduleDrainAfterExit({ queueLength: 2, hasAccessToken: true, hasScheduledTimer: true }),
    false
  );
  // The exact stranded-queue condition: entries waiting, auth available, and
  // nothing already scheduled to pick them up -> must reschedule.
  assert.strictEqual(
    shouldRescheduleDrainAfterExit({ queueLength: 1, hasAccessToken: true, hasScheduledTimer: false }),
    true
  );
}

// Simulates the exact repro sequence from Gate Review blocker 2 at the
// logical level these pure functions operate on (the full imperative
// ref/timer interplay lives in the React coordinator and is NOT exercised
// here — see the test-command report for what remains code-review-only):
//   1. A's drain is mid-await for generation G1 (drainingRef true).
//   2. Identity switches: generationRef -> G2, queue cleared.
//   3. B's event is enqueued for G2 and its scheduleDrain(0) call no-ops
//      because drainingRef is still true (modeled here as "a timer already
//      fired and cleared itself without actually draining").
//   4. A's old drain resolves, notices generationRef (G2) != its captured
//      generation (G1), and exits the loop -> `finally` clears drainingRef.
// Without shouldRescheduleDrainAfterExit, B's now-nonempty queue would be
// stranded (no timer left to pick it up). This proves the fix's decision
// point returns true in exactly that situation.
function testShouldRescheduleDrainAfterExitStrandedQueueScenario() {
  let queue = [{ type: 'incoming', callId: 'call-A', enqueuedAt: 0 }];
  const generationDuringADrain = 1;

  // Step 2: identity switch invalidates A's queue.
  let generation = generationDuringADrain + 1;
  queue = [];

  // Step 3: B's event enqueues for the new generation; its own
  // scheduleDrain(0) timer fires and finds drainingRef still true (A's
  // await hasn't resolved yet) — it no-ops without draining or leaving a
  // pending timer behind.
  queue = enqueueDeduped(queue, { type: 'incoming', callId: 'call-B', enqueuedAt: 10 });
  const timerConsumedWithoutDraining = true; // drainTimerRef.current reset to null when it fired

  // Step 4: A's drain notices the generation mismatch and exits; `finally`
  // clears drainingRef and must now decide whether to reschedule.
  assert.notStrictEqual(generation, generationDuringADrain, 'sanity: identity really did switch');
  const decision = shouldRescheduleDrainAfterExit({
    queueLength: queue.length,
    hasAccessToken: true,
    hasScheduledTimer: !timerConsumedWithoutDraining,
  });
  assert.strictEqual(decision, true, "B's stranded event must trigger a reschedule, not be left queued forever");
}

function run() {
  testIsValidCallId();
  testExtractIncomingCallId();
  testIsEntryExpired();
  testResolveExpiredIncomingDisposition();
  testEnqueueDedupedBasics();
  testEnqueueDedupedCap();
  testRemoveEntriesForCallId();
  testRetryBackoffMs();
  testDecideAuthIdentityTransition();
  testResolveAnswerConfirmation();
  testResolveEndConfirmation();
  testShouldRescheduleDrainAfterExit();
  testShouldRescheduleDrainAfterExitStrandedQueueScenario();
  console.log('nativeCallIntentQueue.test.js: all assertions passed');
}

run();
