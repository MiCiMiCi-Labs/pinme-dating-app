import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatStyles } from './chatStyles';

export function MessageStatus({
  status,
  mine,
  onRetry,
}: {
  status: 'sending' | 'failed' | undefined;
  mine: boolean;
  onRetry: () => void;
}) {
  if (!status) return null;
  if (status === 'sending') {
    return (
      <View style={[chatStyles.statusRow, mine && chatStyles.statusRowMine]}>
        <ActivityIndicator size="small" color="#999" style={chatStyles.statusSpinner} />
        <Text style={chatStyles.statusSendingText}>Sending…</Text>
      </View>
    );
  }
  return (
    <Pressable style={[chatStyles.statusRow, mine && chatStyles.statusRowMine]} onPress={onRetry}>
      <Ionicons name="alert-circle-outline" size={14} color="#EF4444" />
      <Text style={chatStyles.statusFailedText}>Tap to retry</Text>
    </Pressable>
  );
}
