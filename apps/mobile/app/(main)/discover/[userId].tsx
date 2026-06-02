import { SafeAreaView, ScrollView, StyleSheet } from 'react-native';
import { ProfileDetailContent } from '@/components/profile-detail';
import { colors } from '@/design/system';

export default function ProfileDetailScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <ProfileDetailContent />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingBottom: 28,
  },
});
