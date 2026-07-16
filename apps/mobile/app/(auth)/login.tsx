import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { syncAuthUser } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { colors, LogoMark, PrimaryButton, SocialIconButton, TextButton } from '@/design/system';

const oauthRedirectTo = Linking.createURL('auth/callback');

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

function getOAuthParams(url: string) {
  const [, hash = ''] = url.split('#');
  const [, query = ''] = url.split('?');
  const params = new URLSearchParams(hash || query);

  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    error: params.get('error_description') ?? params.get('error'),
  };
}

export default function LoginScreen() {
  const { height } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const topSpacing = keyboardVisible ? 20 : Math.min(height * 0.1, 88);

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

  useEffect(() => {
    async function handleOAuthCallback(url: string) {
      const { accessToken, refreshToken, error: oauthError } = getOAuthParams(url);

      if (oauthError) {
        setError(oauthError);
        return;
      }

      if (!accessToken || !refreshToken) return;

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setError(getLoginErrorMessage(sessionError));
      }
    }

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleOAuthCallback(url);
      }
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleOAuthCallback(url);
    });

    return () => {
      subscription.remove();
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

  const sendPhoneOtp = async () => {
    const normalizedPhone = phone.trim();
    setError(null);

    if (!normalizedPhone.startsWith('+')) {
      setError('Please enter your phone number in international format, e.g. +64211234567.');
      return;
    }

    setSubmitting(true);

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });

      if (otpError) throw otpError;

      setPhoneOtpSent(true);
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyPhoneOtp = async () => {
    const normalizedPhone = phone.trim();
    const token = phoneOtp.trim();
    setError(null);

    if (!token) {
      setError('Please enter the verification code.');
      return;
    }

    setSubmitting(true);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token,
        type: 'sms',
      });

      if (verifyError) throw verifyError;
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const loginWithOAuthProvider = async (provider: 'apple' | 'google' | 'facebook') => {
    setError(null);
    setSubmitting(true);

    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthRedirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data.url) throw new Error(`${provider} login URL was not returned.`);

      const canOpen = await Linking.canOpenURL(data.url);

      if (!canOpen) {
        throw new Error(`Cannot open ${provider} login.`);
      }

      await Linking.openURL(data.url);
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
          <View style={styles.main}>
            {!keyboardVisible ? (
              <View style={styles.logoArea}>
                <LogoMark size={92} />
              </View>
            ) : null}

            {showEmailForm ? (
              <>
                <Pressable style={styles.backButton} onPress={() => setShowEmailForm(false)}>
                  <Ionicons name="chevron-back" size={22} color={colors.primary} />
                </Pressable>

                <Text style={styles.title}>Log in</Text>
                <Text style={styles.copy}>Use your email and password to continue.</Text>

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
              </>
            ) : (
              <>
                <Pressable style={styles.emailPrimaryButton} onPress={() => setShowEmailForm(true)}>
                  <Text style={styles.emailPrimaryText}>Continue with email</Text>
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.phoneField}>
                  <Ionicons name="phone-portrait-outline" size={20} color={colors.grayIcon} />
                  <TextInput
                    value={phone}
                    onChangeText={(value) => {
                      setPhone(value);
                      setPhoneOtpSent(false);
                      setPhoneOtp('');
                    }}
                    keyboardType="phone-pad"
                    placeholder="Phone number, e.g. +64211234567"
                    placeholderTextColor={colors.grayIcon}
                    style={styles.input}
                  />
                </View>

                {phoneOtpSent ? (
                  <View style={styles.phoneField}>
                    <Ionicons name="keypad-outline" size={20} color={colors.grayIcon} />
                    <TextInput
                      value={phoneOtp}
                      onChangeText={setPhoneOtp}
                      keyboardType="number-pad"
                      placeholder="Verification code"
                      placeholderTextColor={colors.grayIcon}
                      style={styles.input}
                    />
                  </View>
                ) : null}

                <Pressable
                  style={[styles.phoneSubmitButton, submitting && styles.disabledButton]}
                  onPress={submitting ? undefined : phoneOtpSent ? verifyPhoneOtp : sendPhoneOtp}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.phoneSubmitText}>
                      {phoneOtpSent ? 'Verify code' : 'Send verification code'}
                    </Text>
                  )}
                </Pressable>

                <View style={styles.socialRow}>
                  {Platform.OS === 'ios' ? (
                    <SocialIconButton
                      icon="logo-apple"
                      onPress={() => loginWithOAuthProvider('apple')}
                    />
                  ) : null}
                  <SocialIconButton
                    icon="logo-google"
                    onPress={() => loginWithOAuthProvider('google')}
                  />
                  <SocialIconButton
                    icon="logo-facebook"
                    onPress={() => loginWithOAuthProvider('facebook')}
                  />
                </View>

                <Text style={styles.termsText}>
                  By continuing, you agree to our{'\n'}
                  <Text style={styles.termsLink}>Terms of Service</Text>
                  {' and '}
                  <Text style={styles.termsLink}>Privacy Policy</Text>.
                </Text>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <View style={styles.footer}>
            {showEmailForm ? (
              <>
                <PrimaryButton onPress={submitting ? undefined : login}>
                  {submitting ? <ActivityIndicator color="#FFFFFF" /> : 'Log in'}
                </PrimaryButton>
                <View style={styles.registerRow}>
                  <Text style={styles.registerText}>New here? </Text>
                  <TextButton onPress={() => router.push('/(auth)/register')}>
                    Create an account
                  </TextButton>
                </View>
              </>
            ) : null}
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
    paddingHorizontal: 32,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: 44,
  },
  main: {
    gap: 12,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 30,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
    marginBottom: 22,
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
  phoneField: {
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
    marginBottom: 8,
  },
  phoneSubmitButton: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    marginBottom: 6,
  },
  phoneSubmitText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.7,
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
  emailPrimaryButton: {
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  emailPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  dividerText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  socialRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  socialButton: {
    flex: 1,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  termsText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 14,
  },
  termsLink: {
    color: colors.primary,
    fontWeight: '800',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    color: colors.muted,
    fontSize: 14,
  },
});
