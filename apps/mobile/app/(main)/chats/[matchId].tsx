import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

// TODO: Chat Room Screen
// - Real-time messages via Supabase Realtime
// - Text / image / GIF message types
// - Report / unmatch options
export default function ChatRoomScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();

  return (
    <View>
      <Text>Chat Room: {matchId}</Text>
    </View>
  );
}
