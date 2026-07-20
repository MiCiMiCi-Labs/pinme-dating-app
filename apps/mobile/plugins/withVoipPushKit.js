const fs = require('fs');
const path = require('path');
const { withAppDelegate, withXcodeProject, IOSConfig } = require('expo/config-plugins');

// PinMe private 1:1 voice calling — phase 3 native plumbing only (see
// docs/private-voice-calling-spec.md "iOS 原生能力").
//
// --- History ---
// The first version of this plugin made the Swift AppDelegate call
// `RNCallKeep`/`RNVoipPushNotificationManager` directly. A real EAS iOS
// Simulator development build (build id
// 526021b8-1e51-4a42-935e-731cac2f1ff9) proved that fails to compile:
//   cannot find 'RNVoipPushNotificationManager' in scope
//   cannot find 'RNCallKeep' in scope
// i.e. these Objective-C classes are not visible to a Swift file in this
// Expo SDK 54 + CocoaPods (non-`use_frameworks!`) autolinking setup without
// further Podfile/bridging-header changes.
//
// --- Current approach: an Objective-C bridge/shim ---
// Instead of a global Podfile change (`use_frameworks!` /
// `use_modular_headers!` / per-pod `:modular_headers`, all of which risk
// breaking Expo/React Native/LiveKit/WebRTC), this plugin now generates two
// small Objective-C files — `PinMeVoipBridge.h`/`.m` — that:
//   - `.m` imports `RNCallKeep.h`/`RNVoipPushNotificationManager.h`
//     directly (ObjC-to-ObjC import, no Swift visibility problem) and calls
//     their real, header-verified class methods.
//   - `.h` exposes only plain C functions using Foundation/PushKit types,
//     which Swift can call unambiguously via the bridging header — no
//     Objective-C class-method name bridging heuristics involved.
// The Swift AppDelegate extension now calls only these C functions and no
// longer references `RNCallKeep`/`RNVoipPushNotificationManager` at all.
//
// This new approach has NOT yet been verified by a second real EAS build —
// see the bottom of this file and docs/private-voice-calling-spec.md for
// exactly what remains unverified. Do not treat a clean `expo config`/local
// `expo prebuild` as evidence the Swift/ObjC/pbxproj plumbing actually
// compiles.
//
// --- Static fixes before that second build ---
// Two bugs caught by static review (before ever spending a build on this):
//   1. Completion ownership: the bridge previously registered the same
//      PushKit `completion` block with BOTH the VoIP push notification
//      native module's own completion-handler table AND CallKit's
//      `withCompletionHandler:`. Only one thing may ever call `completion`.
//      Fixed: only CallKit's own `withCompletionHandler:` calls it now (see
//      PinMeVoipHandleIncomingPush's doc comment below for the exact
//      ownership rule and apps/mobile/lib/voipPushKit.ts for the
//      corresponding note to whoever wires up JS-side event handling next).
//   2. UUID validation: the bridge previously only checked `uuid.length`,
//      not whether it's an actual valid UUID. Fixed: validated with
//      `[[NSUUID alloc] initWithUUIDString:uuid]` before either forwarding
//      the push to JS or reporting to CallKit; an invalid uuid now calls
//      `completion` once and returns NO without forwarding anywhere.

const IMPORT_MARKER = '// @generated pinme-voip-pushkit-import';
const EXTENSION_MARKER = '// @generated pinme-voip-pushkit-delegate';
const BRIDGE_IMPORT_MARKER = '// @generated pinme-voip-bridge-import';
const BRIDGE_HEADER_FILENAME = 'PinMe-Bridging-Header.h';
const BRIDGE_H_FILENAME = 'PinMeVoipBridge.h';
const BRIDGE_M_FILENAME = 'PinMeVoipBridge.m';

// ---------------------------------------------------------------------------
// Objective-C bridge file contents
// ---------------------------------------------------------------------------
//
// UNVERIFIED BY A REAL COMPILE. High-confidence part: the plain C function
// declarations/definitions themselves (ordinary Objective-C/C, no
// third-party-library naming ambiguity). Lower-confidence part: whether
// `#import <RNCallKeep/RNCallKeep.h>` and
// `#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>`
// resolve for an app-target .m file purely from CocoaPods' default (no
// `use_frameworks!`) autolinking header search paths, without any
// additional per-target HEADER_SEARCH_PATHS. Both pods declare their
// headers via a plain `s.source_files = "ios/<Dir>/*.{h,m}"` glob (checked
// against the installed RNCallKeep.podspec / RNVoipPushNotification.podspec
// — neither sets `header_dir`/`header_mappings_dir`), which is the standard
// case CocoaPods handles automatically; no HEADER_SEARCH_PATHS change is
// made here because there is no generated project available in this
// environment to prove one is actually needed (see step 5 in the task this
// plugin was written for). If a future EAS build fails with a "file not
// found" for either header (as opposed to the previous "cannot find ... in
// scope" Swift-visibility error), that would indicate this assumption was
// wrong and a targeted HEADER_SEARCH_PATHS addition for these two pods
// specifically (not a global Podfile change) would be the next step.
const BRIDGE_HEADER_CONTENTS = `// ${BRIDGE_IMPORT_MARKER.replace('// ', '')}
//
// Auto-generated by apps/mobile/plugins/withVoipPushKit.js — do not edit by
// hand, it is overwritten on every \`expo prebuild\`.
//
// Minimal Objective-C bridge so the Swift AppDelegate never has to
// reference the third-party VoIP push notification / CallKit Objective-C
// classes directly (Swift cannot see those classes without further
// Podfile/bridging changes — see the comment block at the top of
// withVoipPushKit.js). Only plain C types (Foundation/PushKit) appear in
// this header so Swift can call these functions unambiguously via the
// bridging header.

#import <Foundation/Foundation.h>
#import <PushKit/PushKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Forwards PushKit's updated push credentials to the VoIP push
/// notification native module (see PinMeVoipBridge.m for the exact
/// third-party call this makes).
void PinMeVoipForwardDidUpdatePushCredentials(PKPushCredentials *credentials, NSString *type);

/// Validates \`uuid\` as a real UUID (via \`NSUUID initWithUUIDString:\`),
/// forwards an incoming VoIP push to the VoIP push notification native
/// module, and reports the call to CallKit — combining what would otherwise
/// be three separate Objective-C calls into one bridge entry point (see
/// PinMeVoipBridge.m for the exact third-party calls this makes).
///
/// completion ownership: exactly one thing ever calls \`completion\`.
///   - Valid uuid: only CallKit's own \`reportNewIncomingCall:...
///     withCompletionHandler:\` calls it, once CallKit has finished
///     reporting the call. This bridge does NOT also register \`completion\`
///     with the VoIP push notification native module — handing the same
///     completion block to two different owners risks it being invoked
///     twice (or the JS side later calling a completion-forwarding API for
///     a completion it was never actually given).
///   - Invalid/missing uuid: this function calls \`completion\` itself,
///     exactly once, and does not forward the push anywhere else.
///
/// If \`uuid\` is nil, empty, or not a syntactically valid UUID (checked
/// with \`NSUUID initWithUUIDString:\`, not merely non-empty), this does NOT
/// forward the push to the VoIP push notification native module (so it
/// never reaches JS), does NOT report anything to CallKit, and does NOT
/// invent a random UUID (a fabricated UUID could never reconcile with a
/// server-side Call.id): it just safely finishes \`completion\` once and
/// returns NO. On the valid path, the original \`uuid\` string (not a
/// re-serialized NSUUID) is what gets passed to CallKit, so casing is never
/// altered in a way that could break JS/REST Call.id reconciliation.
BOOL PinMeVoipHandleIncomingPush(PKPushPayload *payload,
                                  NSString *type,
                                  NSString * _Nullable uuid,
                                  NSString * _Nullable callerName,
                                  NSString * _Nullable handle,
                                  void (^_Nullable completion)(void));

NS_ASSUME_NONNULL_END
`;

const BRIDGE_IMPL_CONTENTS = `// Auto-generated by apps/mobile/plugins/withVoipPushKit.js — do not edit by
// hand, it is overwritten on every \`expo prebuild\`.
//
// This file (and only this file) imports the third-party Objective-C
// headers directly — it is never imported from Swift, so there is no
// Swift-visibility concern here, only ordinary Objective-C-to-Objective-C
// imports.
#import "PinMeVoipBridge.h"
#import <RNCallKeep/RNCallKeep.h>
#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>

void PinMeVoipForwardDidUpdatePushCredentials(PKPushCredentials *credentials, NSString *type) {
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:type];
}

BOOL PinMeVoipHandleIncomingPush(PKPushPayload *payload,
                                  NSString *type,
                                  NSString *uuid,
                                  NSString *callerName,
                                  NSString *handle,
                                  void (^completion)(void)) {
  // Validate the UUID BEFORE forwarding anything — an invalid uuid must not
  // reach JS (via didReceiveIncomingPushWithPayload:forType:) and must not
  // reach CallKit.
  NSUUID *parsedUUID = uuid != nil ? [[NSUUID alloc] initWithUUIDString:uuid] : nil;
  if (parsedUUID == nil) {
    // No usable UUID from the push payload — fail safe rather than create a
    // CallKit call with a fabricated UUID that could never reconcile with a
    // server-side Call.id. This bridge itself is the sole owner of
    // completion on this path: call it exactly once, and do not forward
    // the push anywhere else.
    if (completion) {
      completion();
    }
    return NO;
  }

  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:type];

  // completion ownership: only RNCallKeep's own withCompletionHandler: gets
  // it below — never also registered with
  // RNVoipPushNotificationManager's addCompletionHandler:completionHandler:,
  // which would hand the same completion block to two independent owners.
  // The original uuid string (not parsedUUID.UUIDString) is passed to
  // CallKit so casing is never altered in a way that could break JS/REST
  // Call.id reconciliation.
  [RNCallKeep reportNewIncomingCall:uuid
                             handle:(handle ?: @"")
                         handleType:@"generic"
                           hasVideo:NO
                localizedCallerName:callerName
                    supportsHolding:YES
                       supportsDTMF:YES
                   supportsGrouping:YES
                 supportsUngrouping:YES
                        fromPushKit:YES
                            payload:nil
              withCompletionHandler:completion];
  return YES;
}
`;

// ---------------------------------------------------------------------------
// Swift AppDelegate extension — calls only the bridge's C functions.
// ---------------------------------------------------------------------------

function addSwiftImport(contents) {
  if (contents.includes(IMPORT_MARKER)) return contents;
  return contents.replace(/^import Expo\n/m, (match) => `${match}import PushKit ${IMPORT_MARKER}\n`);
}

function swiftPushKitExtension() {
  return `
${EXTENSION_MARKER}
// PinMe VoIP PushKit/CallKit native plumbing — phase 3, not yet activated
// from the JS side (see apps/mobile/lib/voipPushKit.ts). Reports every VoIP
// push to CallKit immediately per Apple's iOS 13+ requirement: failing to
// call reportNewIncomingCall synchronously on receipt can get the app
// terminated or de-prioritized for further VoIP push delivery.
//
// Calls only PinMeVoipBridge.h's plain C functions (see
// plugins/withVoipPushKit.js) — deliberately never references either
// third-party VoIP/CallKit Objective-C class by name directly here; a first
// real EAS build proved Swift cannot see those classes in this project's
// current CocoaPods configuration ("cannot find ... in scope").
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    PinMeVoipForwardDidUpdatePushCredentials(pushCredentials, type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    // No bridge call here: neither the installed VoIP push notification
    // native module (checked against its real installed header — see
    // withVoipPushKit.js's bridge header comment) nor this bridge declares
    // an invalidation-forwarding entry point. Token invalidation is handled
    // by the JS/server-side VoIP token lifecycle instead (see
    // apps/mobile/lib/voipPushKit.ts). Left as an explicit empty
    // implementation, not omitted, so the delegate conformance stays
    // complete and this gap stays visible rather than silently missing.
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let uuid = payload.dictionaryPayload["uuid"] as? String
    let callerName = payload.dictionaryPayload["callerName"] as? String
    let handle = payload.dictionaryPayload["handle"] as? String

    PinMeVoipHandleIncomingPush(payload, type.rawValue, uuid, callerName, handle, completion)
  }
}
`;
}

function addSwiftPushKitExtension(contents) {
  if (contents.includes(EXTENSION_MARKER)) return contents;
  return `${contents}\n${swiftPushKitExtension()}`;
}

// Pure string transform, no Expo/filesystem dependency — this is what
// withVoipPushKit.test.js exercises directly (twice, to check idempotency)
// against a Swift AppDelegate fixture, without needing a real Expo project
// or `expo prebuild` to run.
function applySwiftAppDelegateTransform(contents) {
  return addSwiftPushKitExtension(addSwiftImport(contents));
}

// ---------------------------------------------------------------------------
// Legacy Objective-C AppDelegate fallback — Expo SDK 54's default template
// is Swift (verified against the real expo-template-bare-minimum@54.0.52
// tarball: `class AppDelegate: ExpoAppDelegate`). This branch is kept only
// for a project that ejected/kept a customized Objective-C AppDelegate.
// It calls RNCallKeep/RNVoipPushNotificationManager directly (no bridge
// needed — Objective-C-to-Objective-C, not a Swift visibility problem).
// ---------------------------------------------------------------------------

function addObjcImport(contents) {
  if (contents.includes(IMPORT_MARKER)) return contents;
  return contents.replace(
    /(#import "AppDelegate\.h")/,
    `$1\n#import <PushKit/PushKit.h> ${IMPORT_MARKER}\n#import "RNVoipPushNotificationManager.h"\n#import "RNCallKeep.h"`
  );
}

function addObjcPushKitMethods(contents) {
  if (contents.includes(EXTENSION_MARKER)) return contents;
  const methods = `
${EXTENSION_MARKER}
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type {
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type {
  // See the Swift extension's equivalent comment — no matching
  // invalidation-forwarding method exists to call through to today.
}

- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type withCompletionHandler:(void (^)(void))completion {
  NSString *uuid = payload.dictionaryPayload[@"uuid"];
  NSString *callerName = payload.dictionaryPayload[@"callerName"];
  NSString *handle = payload.dictionaryPayload[@"handle"];

  // Validate the UUID BEFORE forwarding anything — an invalid uuid must not
  // reach JS and must not reach CallKit. See PinMeVoipBridge.m's equivalent
  // function for the full completion-ownership and UUID-validation
  // rationale (this Objective-C-AppDelegate branch is only a fallback for
  // an ejected/customized project — Expo SDK 54's default template is
  // Swift and uses the bridge instead).
  NSUUID *parsedUUID = uuid != nil ? [[NSUUID alloc] initWithUUIDString:uuid] : nil;
  if (parsedUUID == nil) {
    if (completion) {
      completion();
    }
    return;
  }

  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];

  // completion ownership: only RNCallKeep's own withCompletionHandler: gets
  // it — never also registered with RNVoipPushNotificationManager's
  // addCompletionHandler:completionHandler:.
  [RNCallKeep reportNewIncomingCall:uuid
                             handle:handle
                         handleType:@"generic"
                           hasVideo:NO
                localizedCallerName:callerName
                    supportsHolding:YES
                       supportsDTMF:YES
                   supportsGrouping:YES
                 supportsUngrouping:YES
                        fromPushKit:YES
                            payload:nil
              withCompletionHandler:completion];
}
`;
  const lastEndIndex = contents.lastIndexOf('@end');
  if (lastEndIndex === -1) return contents + methods;
  return contents.slice(0, lastEndIndex) + methods + '\n' + contents.slice(lastEndIndex);
}

function applyObjcAppDelegateTransform(contents) {
  return addObjcPushKitMethods(addObjcImport(contents));
}

const withVoipPushKitAppDelegate = (config) => {
  return withAppDelegate(config, (config) => {
    const { language } = config.modResults;
    if (language === 'swift') {
      config.modResults.contents = applySwiftAppDelegateTransform(config.modResults.contents);
    } else if (language === 'objc' || language === 'objcpp') {
      config.modResults.contents = applyObjcAppDelegateTransform(config.modResults.contents);
    } else {
      throw new Error(`withVoipPushKit: unsupported AppDelegate language "${language}"`);
    }
    return config;
  });
};

// ---------------------------------------------------------------------------
// Bridge files + Xcode project wiring (Swift projects only — the ObjC
// fallback branch above needs no bridge/bridging-header at all).
// ---------------------------------------------------------------------------

// Pure helper (no fs/Expo dependency) — exported for withVoipPushKit.test.js
// to verify the "append once, guarded by marker" idempotency directly,
// without needing to fake a whole Xcode project object.
function appendImportIfMissing(contents, importLine, marker) {
  if (contents.includes(marker)) return contents;
  return `${contents}${contents ? '\n' : ''}${importLine}\n`;
}

function ensureBridgingHeaderHasImport(project, targetName, sourceRoot, platformProjectRoot, projectName) {
  const importLine = `#import "${BRIDGE_H_FILENAME}" ${BRIDGE_IMPORT_MARKER}`;
  const existingSetting = project.getBuildProperty('SWIFT_OBJC_BRIDGING_HEADER', undefined, targetName);

  if (existingSetting) {
    // An existing bridging header is already wired up (by another plugin,
    // or a customized project) — merge our import into it, never overwrite
    // the build setting or the file's other contents.
    const unquoted = String(existingSetting).replace(/^"|"$/g, '');
    const headerPath = path.isAbsolute(unquoted) ? unquoted : path.join(platformProjectRoot, unquoted);
    let contents;
    try {
      contents = fs.readFileSync(headerPath, 'utf8');
    } catch (error) {
      throw new Error(
        `withVoipPushKit: SWIFT_OBJC_BRIDGING_HEADER is set to "${existingSetting}" but no file was found at ${headerPath}; refusing to guess how to proceed (${error.message}).`
      );
    }
    const merged = appendImportIfMissing(contents, importLine, BRIDGE_IMPORT_MARKER);
    if (merged !== contents) {
      fs.writeFileSync(headerPath, merged);
    }
    return;
  }

  // No existing bridging header for this target — create a project-owned
  // one and point the build setting at it (path relative to SRCROOT, same
  // convention Xcode itself uses for this setting).
  const newHeaderPath = path.join(sourceRoot, BRIDGE_HEADER_FILENAME);
  let contents = '';
  try {
    contents = fs.readFileSync(newHeaderPath, 'utf8');
  } catch {
    // Doesn't exist yet — created below.
  }
  const merged = appendImportIfMissing(contents, importLine, BRIDGE_IMPORT_MARKER);
  if (merged !== contents) {
    fs.writeFileSync(newHeaderPath, merged);
  }
  project.updateBuildProperty(
    'SWIFT_OBJC_BRIDGING_HEADER',
    `"${projectName}/${BRIDGE_HEADER_FILENAME}"`,
    undefined,
    targetName
  );
}

const withVoipPushKitNativeBridge = (config) => {
  return withXcodeProject(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const platformProjectRoot = config.modRequest.platformProjectRoot;

    // The bridge only exists to solve a Swift-visibility problem — skip
    // entirely for the Objective-C AppDelegate fallback, which calls the
    // third-party classes directly with no such problem.
    const appDelegate = IOSConfig.Paths.getAppDelegate(projectRoot);
    if (appDelegate.language !== 'swift') {
      return config;
    }

    const sourceRoot = path.dirname(appDelegate.path);
    const projectName = path.basename(sourceRoot);
    let project = config.modResults;
    const nativeTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
    const targetName = nativeTarget.target.name;

    // 1. Write the bridge .h/.m — same content every run, so this alone is
    // idempotent regardless of how many times prebuild runs.
    fs.writeFileSync(path.join(sourceRoot, BRIDGE_H_FILENAME), BRIDGE_HEADER_CONTENTS);
    fs.writeFileSync(path.join(sourceRoot, BRIDGE_M_FILENAME), BRIDGE_IMPL_CONTENTS);

    // 2. Add PinMeVoipBridge.m to the app target's Compile Sources phase.
    //
    // Gate #2 (EAS build 13a8fc41-761c-494d-b2b6-f2492f1edca6) proved that
    // calling the raw xcode-package `addSourceFile` method directly (with
    // no `group` argument) crashes PREBUILD itself:
    //   TypeError: Cannot read properties of null (reading 'path')
    //   at correctForPath (node_modules/xcode/lib/pbxProject.js:1682)
    // Omitting `group` makes the `xcode` package fall through to
    // `addPluginFile`, which requires a PBXGroup literally named "Plugins"
    // to exist (`project.pbxGroupByName('Plugins').path`) — Expo SDK 54's
    // generated project has no such group, so that lookup returns null and
    // `.path` throws before pod install or any compile step ever runs.
    //
    // Fixed by using Expo's own official helper instead, which resolves
    // the *app's own* PBXGroup by name (guaranteed to exist — it's the
    // group AppDelegate.swift itself lives in) rather than assuming a
    // "Plugins" group, and returns the (mutated) project to reassign.
    const relativeImplPath = `${projectName}/${BRIDGE_M_FILENAME}`;
    config.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: relativeImplPath,
      groupName: projectName,
      project,
      targetUuid: nativeTarget.uuid,
      verbose: true,
    });
    project = config.modResults;

    // 3. Bridging header: merge into whatever already exists, or create one
    // and wire SWIFT_OBJC_BRIDGING_HEADER — across every build
    // configuration (`updateBuildProperty` with `build: undefined` updates
    // all of them, not just Debug).
    ensureBridgingHeaderHasImport(project, targetName, sourceRoot, platformProjectRoot, projectName);

    return config;
  });
};

module.exports = function withVoipPushKit(config) {
  config = withVoipPushKitAppDelegate(config);
  config = withVoipPushKitNativeBridge(config);
  return config;
};

// Exported for withVoipPushKit.test.js (plain Node script, no test
// framework) — not used by the Expo config plugin pipeline itself.
module.exports.applySwiftAppDelegateTransform = applySwiftAppDelegateTransform;
module.exports.applyObjcAppDelegateTransform = applyObjcAppDelegateTransform;
module.exports.IMPORT_MARKER = IMPORT_MARKER;
module.exports.EXTENSION_MARKER = EXTENSION_MARKER;
module.exports.BRIDGE_HEADER_CONTENTS = BRIDGE_HEADER_CONTENTS;
module.exports.BRIDGE_IMPL_CONTENTS = BRIDGE_IMPL_CONTENTS;
module.exports.BRIDGE_IMPORT_MARKER = BRIDGE_IMPORT_MARKER;
module.exports.appendImportIfMissing = appendImportIfMissing;
