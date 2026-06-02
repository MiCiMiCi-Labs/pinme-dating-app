import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, LogoMark, PrimaryButton } from '@/design/system';

export default function RegisterScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.logoArea}>
        <LogoMark size={128} />
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Sign up to continue</Text>
        <PrimaryButton onPress={() => router.push('/(auth)/create-profile')}>
          Continue with email
        </PrimaryButton>
        <PrimaryButton variant="outline" onPress={() => router.push('/(auth)/login')}>
          Use phone number
        </PrimaryButton>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or sign up with</Text>
          <View style={styles.divider} />
        </View>

        <View style={styles.socialRow}>
          <Pressable style={styles.socialButton}>
            <FontAwesome name="facebook-official" size={28} color={colors.primary} />
          </Pressable>
          <Pressable style={styles.socialButton}>
            <Text style={styles.google}>G</Text>
          </Pressable>
          <Pressable style={styles.socialButton}>
            <Ionicons name="logo-apple" size={31} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.legalRow}>
        <Text style={styles.legal}>Terms of use</Text>
        <Text style={styles.legal}>Privacy Policy</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
  },
  logoArea: {
    flex: 0.9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 34,
  },
  content: {
    gap: 20,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 34,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E2E7',
  },
  dividerText: {
    color: colors.text,
    fontSize: 12,
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 6,
  },
  socialButton: {
    width: 64,
    height: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  google: {
    color: colors.primary,
    fontSize: 31,
    fontWeight: '900',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 34,
    paddingBottom: 34,
    paddingTop: 40,
  },
  legal: {
    color: colors.primary,
    fontSize: 13,
  },
});
