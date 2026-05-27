import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

// TODO: Report Screen
// - Report reason selection + optional description
// - Submit to POST /api/v1/reports
export default function ReportScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  return (
    <View>
      <Text>Report User: {userId}</Text>
    </View>
  );
}
