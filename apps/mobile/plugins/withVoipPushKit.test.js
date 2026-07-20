// Plain Node script (no test framework) verifying withVoipPushKit.js's pure
// string-transformation logic. Run with: node plugins/withVoipPushKit.test.js
//
// This does NOT exercise the Expo config-plugin pipeline (withAppDelegate,
// withXcodeProject, mod resolution, a real project directory) — only the
// string-transform building blocks, against a fixture reproducing the real
// Expo SDK 54 Swift AppDelegate template's shape (verified earlier against a
// real `expo-template-bare-minimum@54.0.52` tarball: `import Expo` as the
// first line, `class AppDelegate: ExpoAppDelegate`). It cannot and does not
// prove the injected Swift/Objective-C actually compiles — see
// withVoipPushKit.js's own "UNVERIFIED BY A REAL COMPILE" comments, and
// docs/private-voice-calling-spec.md, for exactly what remains unverified
// (a first real EAS build already proved the *previous*, direct-reference
// approach fails; this bridge approach has not yet had a second real build).

const assert = require('node:assert');
const {
  applySwiftAppDelegateTransform,
  applyObjcAppDelegateTransform,
  IMPORT_MARKER,
  EXTENSION_MARKER,
  BRIDGE_HEADER_CONTENTS,
  BRIDGE_IMPL_CONTENTS,
  BRIDGE_IMPORT_MARKER,
  appendImportIfMissing,
} = require('./withVoipPushKit');

const SWIFT_APP_DELEGATE_FIXTURE = `import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function testSwiftAppDelegateTransform() {
  const once = applySwiftAppDelegateTransform(SWIFT_APP_DELEGATE_FIXTURE);
  const twice = applySwiftAppDelegateTransform(once);

  // Idempotency: applying the transform a second time must not duplicate
  // either marker, and must produce byte-identical output to the first
  // application.
  assert.strictEqual(twice, once, 'applying the transform twice must be a no-op the second time');
  assert.strictEqual(countOccurrences(twice, IMPORT_MARKER), 1, 'import marker must appear exactly once');
  assert.strictEqual(countOccurrences(twice, EXTENSION_MARKER), 1, 'delegate marker must appear exactly once');

  // Bridge approach: the Swift output must never reference the two
  // third-party classes directly — only the bridge's own C functions.
  assert.ok(!twice.includes('RNCallKeep'), 'Swift output must not reference RNCallKeep directly');
  assert.ok(
    !twice.includes('RNVoipPushNotificationManager'),
    'Swift output must not reference RNVoipPushNotificationManager directly'
  );
  assert.ok(
    twice.includes('PinMeVoipForwardDidUpdatePushCredentials('),
    'Swift output must call the bridge credentials-forwarding function'
  );
  assert.ok(
    twice.includes('PinMeVoipHandleIncomingPush('),
    'Swift output must call the bridge incoming-push function'
  );

  // The nonexistent native API must never appear in the output.
  assert.ok(
    !twice.includes('didInvalidatePushTokenForType'),
    'must not call the nonexistent RNVoipPushNotificationManager.didInvalidatePushTokenForType'
  );

  // The didInvalidatePushTokenFor delegate method itself must still be
  // present (as a required empty implementation), just without a body that
  // calls anything.
  assert.ok(
    twice.includes('func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType)'),
    'didInvalidatePushTokenFor delegate method must still be present (empty implementation)'
  );

  // Sanity: the other two delegate methods and the import are present too.
  assert.ok(twice.includes('import PushKit'), 'PushKit import must be present');
  assert.ok(twice.includes('extension AppDelegate: PKPushRegistryDelegate'), 'delegate extension must be present');
  assert.ok(
    twice.includes('func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType)'),
    'didUpdate delegate method must be present'
  );
  assert.ok(
    twice.includes('didReceiveIncomingPushWith payload: PKPushPayload'),
    'didReceiveIncomingPushWith delegate method must be present'
  );
}

function testBridgeImplementationUsesRealSelectors() {
  // Selectors verified against the actually installed headers:
  //   node_modules/react-native-callkeep/ios/RNCallKeep/RNCallKeep.h
  //   node_modules/react-native-voip-push-notification/ios/RNVoipPushNotification/RNVoipPushNotificationManager.h
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('[RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:type]'),
    'bridge .m must call the real didUpdatePushCredentials:forType: selector'
  );
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('[RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:type]'),
    'bridge .m must call the real didReceiveIncomingPushWithPayload:forType: selector'
  );
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('[RNCallKeep reportNewIncomingCall:uuid'),
    'bridge .m must call the real reportNewIncomingCall:... selector'
  );
  // The nonexistent method must never appear in the bridge implementation.
  assert.ok(
    !BRIDGE_IMPL_CONTENTS.includes('didInvalidatePushTokenForType'),
    'bridge .m must not call the nonexistent didInvalidatePushTokenForType'
  );

  // The .m file — and only the .m file — imports the real third-party
  // headers (ObjC-to-ObjC, no Swift visibility problem there).
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('#import <RNCallKeep/RNCallKeep.h>'),
    'bridge .m must import the real RNCallKeep pod header'
  );
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>'),
    'bridge .m must import the real RNVoipPushNotification pod header'
  );

  // The .h must expose only plain C types — no third-party class import.
  assert.ok(!BRIDGE_HEADER_CONTENTS.includes('RNCallKeep'), 'bridge .h must not mention RNCallKeep');
  assert.ok(
    !BRIDGE_HEADER_CONTENTS.includes('RNVoipPushNotificationManager.h'),
    'bridge .h must not import RNVoipPushNotificationManager.h'
  );
}

function testCompletionHasExactlyOneOwner() {
  // The bridge must never register the same completion block with the VoIP
  // push notification native module's own completion-handler table — only
  // RNCallKeep's own withCompletionHandler: may ever call it.
  assert.ok(
    !BRIDGE_IMPL_CONTENTS.includes('[RNVoipPushNotificationManager addCompletionHandler:'),
    'bridge .m must not call addCompletionHandler:completionHandler: at all (single completion owner: RNCallKeep)'
  );
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('withCompletionHandler:completion'),
    'bridge .m must still pass completion through to RNCallKeep reportNewIncomingCall:...withCompletionHandler:'
  );

  // On the invalid-uuid branch, the bridge itself must call completion()
  // directly (its only other appearance besides the RNCallKeep call).
  const completionCallSites = (BRIDGE_IMPL_CONTENTS.match(/\bcompletion\(\)/g) || []).length;
  assert.strictEqual(
    completionCallSites,
    1,
    'bridge .m must call completion() directly exactly once (the invalid-uuid fail-safe path)'
  );
}

function testUuidValidationOrderAndBranches() {
  // Real UUID-format validation, not just a length/nil check.
  assert.ok(
    BRIDGE_IMPL_CONTENTS.includes('[[NSUUID alloc] initWithUUIDString:uuid]'),
    'bridge .m must validate uuid format via NSUUID initWithUUIDString:'
  );
  assert.ok(
    !BRIDGE_IMPL_CONTENTS.includes('[NSUUID UUID]'),
    'bridge .m must not fabricate a random UUID for an invalid/missing incoming-push uuid'
  );

  // Validation must happen BEFORE didReceiveIncomingPushWithPayload:forType:
  // (an invalid uuid must never be forwarded to JS).
  const validationIndex = BRIDGE_IMPL_CONTENTS.indexOf('initWithUUIDString:uuid');
  const forwardIndex = BRIDGE_IMPL_CONTENTS.indexOf('didReceiveIncomingPushWithPayload:payload forType:type');
  assert.ok(validationIndex !== -1 && forwardIndex !== -1, 'both the validation call and the forwarding call must be present');
  assert.ok(
    validationIndex < forwardIndex,
    'UUID validation must happen before forwarding the push to the VoIP push notification native module'
  );

  // Invalid branch: calls completion and returns NO, without reaching the
  // forwarding call at all (checked structurally: the "if (parsedUUID ==
  // nil)" block, up to its closing brace, must contain "return NO;" and
  // must NOT contain the forwarding call).
  const nilCheckStart = BRIDGE_IMPL_CONTENTS.indexOf('if (parsedUUID == nil)');
  const nilCheckEnd = BRIDGE_IMPL_CONTENTS.indexOf('return NO;', nilCheckStart);
  assert.ok(nilCheckStart !== -1 && nilCheckEnd !== -1, 'invalid-uuid branch must exist and return NO');
  const nilCheckBlock = BRIDGE_IMPL_CONTENTS.slice(nilCheckStart, nilCheckEnd);
  assert.ok(nilCheckBlock.includes('completion()'), 'invalid-uuid branch must call completion()');
  assert.ok(
    !nilCheckBlock.includes('didReceiveIncomingPushWithPayload'),
    'invalid-uuid branch must not forward the push before returning NO'
  );
  assert.ok(!nilCheckBlock.includes('reportNewIncomingCall'), 'invalid-uuid branch must not report to CallKit');
}

function testNoGlobalPodfileStrategyChange() {
  // The generated native files themselves (what actually ends up in the
  // Xcode project) must never contain these directives.
  for (const contents of [BRIDGE_HEADER_CONTENTS, BRIDGE_IMPL_CONTENTS]) {
    assert.ok(!contents.includes('use_frameworks!'), 'bridge files must not reference use_frameworks!');
    assert.ok(!contents.includes('use_modular_headers!'), 'bridge files must not reference use_modular_headers!');
    assert.ok(!contents.includes(':modular_headers'), 'bridge files must not reference :modular_headers');
  }

  // The plugin must have no code path capable of touching the Podfile at
  // all — `withPodfile`/`withPodfileProperties` are the only config-plugin
  // APIs that could set use_frameworks!/use_modular_headers!/per-pod
  // :modular_headers, so their complete absence is a stronger guarantee
  // than grepping for those literal strings (which also show up
  // legitimately in this file's own explanatory comments about why they
  // were deliberately NOT used).
  const pluginSource = require('fs').readFileSync(require.resolve('./withVoipPushKit.js'), 'utf8');
  assert.ok(!/\bwithPodfile\b/.test(pluginSource), 'plugin must not use withPodfile/withPodfileProperties (no Podfile access at all)');
}

function testBridgingHeaderImportNotDuplicated() {
  const importLine = '#import "PinMeVoipBridge.h" ' + BRIDGE_IMPORT_MARKER;

  // Simulates creating a brand-new bridging header, then "re-running
  // prebuild" against the already-merged result.
  const first = appendImportIfMissing('', importLine, BRIDGE_IMPORT_MARKER);
  const second = appendImportIfMissing(first, importLine, BRIDGE_IMPORT_MARKER);
  assert.strictEqual(second, first, 'appending twice into an empty header must be a no-op the second time');
  assert.strictEqual(countOccurrences(second, BRIDGE_IMPORT_MARKER), 1, 'import marker must appear exactly once');

  // Simulates merging into an EXISTING bridging header that already has
  // unrelated content — that content must survive untouched, and re-running
  // must still not duplicate the import.
  const existingHeaderContents = '#import "SomeOtherPod-Bridging-Header.h"\n';
  const merged = appendImportIfMissing(existingHeaderContents, importLine, BRIDGE_IMPORT_MARKER);
  assert.ok(merged.includes('SomeOtherPod-Bridging-Header.h'), 'must not remove pre-existing bridging header content');
  assert.ok(merged.includes(importLine), 'must append the PinMe bridge import');
  const mergedAgain = appendImportIfMissing(merged, importLine, BRIDGE_IMPORT_MARKER);
  assert.strictEqual(mergedAgain, merged, 're-merging into an already-merged header must be a no-op');
  assert.strictEqual(countOccurrences(mergedAgain, BRIDGE_IMPORT_MARKER), 1, 'import marker must appear exactly once even when merged into existing content');
}

const OBJC_APP_DELEGATE_FIXTURE = `#import "AppDelegate.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  return YES;
}

@end
`;

function testObjcFallbackHasSameFixes() {
  const once = applyObjcAppDelegateTransform(OBJC_APP_DELEGATE_FIXTURE);
  const twice = applyObjcAppDelegateTransform(once);

  // Idempotency, same as the Swift branch.
  assert.strictEqual(twice, once, 'applying the ObjC transform twice must be a no-op the second time');
  assert.strictEqual(countOccurrences(twice, IMPORT_MARKER), 1, 'ObjC import marker must appear exactly once');
  assert.strictEqual(countOccurrences(twice, EXTENSION_MARKER), 1, 'ObjC delegate marker must appear exactly once');

  // Single completion owner: no addCompletionHandler call at all.
  assert.ok(
    !twice.includes('[RNVoipPushNotificationManager addCompletionHandler:'),
    'ObjC fallback must not call addCompletionHandler:completionHandler: (single completion owner: RNCallKeep)'
  );
  assert.ok(
    twice.includes('withCompletionHandler:completion'),
    'ObjC fallback must still pass completion through to RNCallKeep reportNewIncomingCall:...withCompletionHandler:'
  );

  // Real UUID-format validation, in the right order.
  assert.ok(
    twice.includes('[[NSUUID alloc] initWithUUIDString:uuid]'),
    'ObjC fallback must validate uuid format via NSUUID initWithUUIDString:'
  );
  const validationIndex = twice.indexOf('initWithUUIDString:uuid');
  const forwardIndex = twice.indexOf('didReceiveIncomingPushWithPayload:payload forType:(NSString *)type');
  assert.ok(validationIndex !== -1 && forwardIndex !== -1, 'ObjC: both validation and forwarding calls must be present');
  assert.ok(validationIndex < forwardIndex, 'ObjC: UUID validation must happen before forwarding the push to JS');

  // Invalid branch: returns without forwarding or reporting to CallKit.
  const nilCheckStart = twice.indexOf('if (parsedUUID == nil)');
  assert.ok(nilCheckStart !== -1, 'ObjC fallback must have the invalid-uuid branch');
  const nilCheckEnd = twice.indexOf('}', nilCheckStart);
  const nilCheckBlock = twice.slice(nilCheckStart, nilCheckEnd);
  assert.ok(nilCheckBlock.includes('completion()'), 'ObjC invalid-uuid branch must call completion()');
  assert.ok(
    !nilCheckBlock.includes('didReceiveIncomingPushWithPayload'),
    'ObjC invalid-uuid branch must not forward the push'
  );
  assert.ok(!nilCheckBlock.includes('reportNewIncomingCall'), 'ObjC invalid-uuid branch must not report to CallKit');

  assert.ok(
    !twice.includes('[NSUUID UUID]'),
    'ObjC fallback must not fabricate a random UUID for an invalid/missing incoming-push uuid'
  );
}

function testUsesOfficialXcodeGroupHelper() {
  // Gate #2 (EAS build 13a8fc41-761c-494d-b2b6-f2492f1edca6) proved the raw
  // `project.addSourceFile(path, opt)` call (no `group` argument) crashes
  // PREBUILD itself — it falls through to `xcode`'s `addPluginFile`, which
  // requires a "Plugins" PBXGroup that Expo SDK 54 projects don't have.
  //
  // This only checks the plugin's *source text* for correct API usage —
  // it deliberately does NOT fake a full pbxproj/XcodeProject object to
  // exercise `withVoipPushKitNativeBridge` end-to-end, since a hand-rolled
  // fixture pbxproj would be unreliable and could hide real bugs rather
  // than catch them. Whether this actually fixes PREBUILD still requires a
  // real EAS build — see docs/private-voice-calling-spec.md.
  const pluginSource = require('fs').readFileSync(require.resolve('./withVoipPushKit.js'), 'utf8');

  assert.ok(
    !pluginSource.includes('project.addSourceFile('),
    'plugin must not call the raw project.addSourceFile(...) (crashes prebuild — no "Plugins" PBXGroup in Expo SDK 54 projects)'
  );
  assert.ok(
    pluginSource.includes('IOSConfig.XcodeUtils.addBuildSourceFileToGroup('),
    "plugin must use the official IOSConfig.XcodeUtils.addBuildSourceFileToGroup helper"
  );
  assert.ok(
    /groupName:\s*projectName/.test(pluginSource),
    "plugin must pass groupName: projectName (the app's own PBXGroup, guaranteed to exist)"
  );
  assert.ok(
    /targetUuid:\s*nativeTarget\.uuid/.test(pluginSource),
    'plugin must pass targetUuid: nativeTarget.uuid (the application native target UUID)'
  );
  assert.ok(
    /config\.modResults\s*=\s*IOSConfig\.XcodeUtils\.addBuildSourceFileToGroup\(/.test(pluginSource),
    "the helper's returned project must be reassigned back to config.modResults"
  );
}

function run() {
  testSwiftAppDelegateTransform();
  testBridgeImplementationUsesRealSelectors();
  testCompletionHasExactlyOneOwner();
  testUuidValidationOrderAndBranches();
  testNoGlobalPodfileStrategyChange();
  testBridgingHeaderImportNotDuplicated();
  testObjcFallbackHasSameFixes();
  testUsesOfficialXcodeGroupHelper();
  console.log('withVoipPushKit.test.js: all assertions passed');
}

run();
