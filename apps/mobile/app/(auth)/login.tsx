import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { syncAuthUser } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { colors, LogoMark, PrimaryButton } from '@/design/system';

function getLoginErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('email not confirmed')) {
      return 'Please confirm your email before logging in.';
    }

    return error.message;
  }

  return 'Failed to log in';
}

export default function LoginScreen() {
  const { height } = useWindowDimensions();
  const [email, setEmail] = useState('123@gmail.com');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const topSpacing = keyboardVisible ? 20 : Math.min(height * 0.08, 68);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const login = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) throw authError;
      if (!data.session?.access_token) {
        throw new Error('Login succeeded but no session was returned.');
      }

      await syncAuthUser(data.session.access_token);
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingTop: topSpacing }]}
        >
          <View>
            {!keyboardVisible ? (
              <View style={styles.logoArea}>
                <LogoMark size={86} />
              </View>
            ) : null}

            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.copy}>
              Log in with your Supabase email and password to continue.
            </Text>

            <View style={styles.field}>
              <Ionicons name="mail-outline" size={20} color={colors.grayIcon} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor={colors.grayIcon}
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.grayIcon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Password"
                placeholderTextColor={colors.grayIcon}
                style={styles.input}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.footer}>
            <PrimaryButton onPress={submitting ? undefined : login}>
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : 'Log in'}
            </PrimaryButton>
            <View style={styles.registerRow}>
              <Text style={styles.registerText}>New to PinMe? </Text>
              <Pressable onPress={() => router.push('/(auth)/register')}>
                <Text style={styles.registerLink}>Create account</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
    paddingHorizontal: 40,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: 44,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 34,
  },
  field: {
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  footer: {
    gap: 22,
    paddingTop: 26,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    color: colors.muted,
    fontSize: 14,
  },
  registerLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
});
