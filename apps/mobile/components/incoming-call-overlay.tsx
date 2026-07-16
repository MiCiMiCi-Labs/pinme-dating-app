import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/design/system';

type Props = {
  callerName: string;
  callerAvatar: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

// Full-screen, shown from CallProvider regardless of which screen the user
// is currently on (docs/private-voice-calling-spec.md "应用内来电界面" /
// "全局 CallProvider" — incoming calls cannot be tied to the chat screen).
export function IncomingCallOverlay({ callerName, callerAvatar, onAccept, onDecline }: Props) {
  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.label}>Incoming voice call</Text>

          <View style={styles.avatarWrap}>
            {callerAvatar ? (
              <Image source={{ uri: callerAvatar }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={48} color="rgba(255,255,255,0.6)" />
              </View>
            )}
            <View style={styles.pulseRing} />
          </View>

          <Text style={styles.name}>{callerName}</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.actionColumn}>
            <Pressable style={[styles.actionBtn, styles.declineBtn]} onPress={onDecline}>
              <Ionicons name="call" size={30} color="#FFFFFF" style={styles.declineIcon} />
            </Pressable>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          <View style={styles.actionColumn}>
            <Pressable style={[styles.actionBtn, styles.acceptBtn]} onPress={onAccept}>
              <Ionicons name="call" size={30} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  label: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  avatarWrap: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarFallback: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingBottom: 56,
    paddingHorizontal: 40,
  },
  actionColumn: {
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    backgroundColor: '#EF4444',
  },
  declineIcon: {
    transform: [{ rotate: '135deg' }],
  },
  acceptBtn: {
    backgroundColor: '#22C55E',
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
});
