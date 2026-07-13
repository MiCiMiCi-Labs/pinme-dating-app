import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, PrimaryButton } from '@/design/system';

export default function ConfirmEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={44} color={colors.primary} />
        </View>

        <Text style={styles.title}>Confirm your email</Text>
        <Text style={styles.copy}>
          We sent a confirmation link{email ? ` to ${email}` : ''}. Open it first, then come back
          and log in with your password.
        </Text>

        <View style={styles.actions}>
          <PrimaryButton onPress={() => router.replace('/(auth)/login')}>
            I confirmed, log in
          </PrimaryButton>
          <PrimaryButton variant="outline" onPress={() => router.replace('/(auth)/register')}>
            Use another email
          </PrimaryButton>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 86,
    height: 86,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    marginBottom: 28,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  copy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
  },
  actions: {
    gap: 14,
    marginTop: 34,
  },
});
