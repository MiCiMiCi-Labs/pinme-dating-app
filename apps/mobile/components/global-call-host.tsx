import Constants from 'expo-constants';
import { lazy, Suspense } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCall } from '@/contexts/call';
import { IncomingCallOverlay } from '@/components/incoming-call-overlay';

const VoiceCallModal = lazy(() =>
  import('@/components/voice-call-modal').then(m => ({ default: m.VoiceCallModal }))
);

const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

// Mounted once, above the app's screen stack (see app/_layout.tsx), so
// incoming/active calls render regardless of which screen the user is on —
// docs/private-voice-calling-spec.md explicitly forbids keeping the full
// Call state only on the chat screen.
export function GlobalCallHost() {
  const {
    phase,
    activeCall,
    acceptCall,
    declineCall,
    cancelCall,
    endCall,
    reportMediaConnected,
    reportMediaDisconnected,
    reportMediaFailure,
    confirmCallOrFail,
  } = useCall();

  if (!activeCall) return null;

  const { call, role, livekit } = activeCall;
  const partner = role === 'caller' ? call.callee : call.caller;

  if (phase === 'incomingRinging') {
    return (
      <IncomingCallOverlay
        callerName={partner.name}
        callerAvatar={partner.photoUrl}
        onAccept={IS_EXPO_GO ? () => declineCall() : acceptCall}
        onDecline={declineCall}
      />
    );
  }

  if (IS_EXPO_GO) {
    // LiveKit's native module isn't available in Expo Go. This should be
    // unreachable in practice (startCall/acceptCall guard against it), but
    // fail safe with a plain message instead of crashing on the native import.
    return (
      <Modal visible statusBarTranslucent>
        <SafeAreaView style={styles.expoGoScreen}>
          <Text style={styles.expoGoText}>
            Voice calls require a development build. Please use `expo run:ios`/`expo run:android`.
          </Text>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Suspense fallback={null}>
      <VoiceCallModal
        call={call}
        role={role}
        livekit={livekit}
        phase={phase}
        partnerName={partner.name}
        partnerAvatar={partner.photoUrl ?? ''}
        onCancel={cancelCall}
        onEnd={endCall}
        onMediaConnected={reportMediaConnected}
        onMediaDisconnected={reportMediaDisconnected}
        onReportFailure={reportMediaFailure}
        onConfirmOrFail={confirmCallOrFail}
      />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  expoGoScreen: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  expoGoText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
  },
});
