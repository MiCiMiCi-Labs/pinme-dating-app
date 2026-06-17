import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, LogoMark, PrimaryButton } from '@/design/system';
import { birthdayInputToIso, formatBirthdayInput } from '@/lib/birthday';
import type { Gender } from '@/lib/api';

const genderOptions: Array<{ label: string; value: Gender }> = [
  { label: 'Woman', value: 'FEMALE' },
  { label: 'Man', value: 'MALE' },
  { label: 'Non-binary', value: 'NON_BINARY' },
  { label: 'Self-describe', value: 'SELF_DESCRIBE' },
  { label: 'Prefer not to say', value: 'PREFER_NOT_TO_SAY' },
];

function getRegistrationValidationError({
  name,
  email,
  password,
  birthday,
}: {
  name: string;
  email: string;
  password: string;
  birthday: string;
}) {
  if (!name.trim()) {
    return 'Name is required';
  }

  if (!email.trim()) {
    return 'Email is required';
  }

  if (!password) {
    return 'Password is required';
  }

  if (!birthday.trim()) {
    return 'Birthday is required';
  }

  if (!birthdayInputToIso(birthday)) {
    return 'Birthday must be a valid date, e.g. 01-01-2000';
  }

  return null;
}

export default function RegisterScreen() {
  const [name, setName] = useState('Mia');
  const [email, setEmail] = useState('123@gmail.com');
  const [password, setPassword] = useState('');
  const [birthday, setBirthday] = useState('01-01-2000');
  const [gender, setGender] = useState<Gender>('FEMALE');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    setError(null);
    setMessage(null);

    const validationError = getRegistrationValidationError({
      name,
      email,
      password,
      birthday,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const birthdayIso = birthdayInputToIso(birthday);

      if (!birthdayIso) {
        setError('Birthday must be a valid date, e.g. 01-01-2000');
        return;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            gender,
            birthday: birthdayIso,
          },
        },
      });

      if (authError) throw authError;

      if (data.session) {
        await supabase.auth.signOut();
      }

      router.replace({
        pathname: '/(auth)/confirm-email',
        params: { email: email.trim() },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
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
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoArea}>
            <LogoMark size={84} />
          </View>

          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.copy}>
            Supabase creates the login account. PinMe syncs your required profile fields to the
            backend.
          </Text>

          <AuthField icon="person-outline" value={name} onChangeText={setName} placeholder="Name" />
          <AuthField
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
          />
          <AuthField
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
          />
          <AuthField
            icon="calendar-outline"
            value={birthday}
            onChangeText={(value) => setBirthday(formatBirthdayInput(value))}
            placeholder="Birthday, e.g. 01-01-2000"
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderGrid}>
            {genderOptions.map((option) => {
              const selected = gender === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.genderOption, selected && styles.genderOptionSelected]}
                  onPress={() => setGender(option.value)}
                >
                  <Text style={[styles.genderText, selected && styles.genderTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <PrimaryButton onPress={submitting ? undefined : register} style={styles.submit}>
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : 'Create account'}
          </PrimaryButton>

          <View style={styles.signInRow}>
            <Text style={styles.signInText}>Already have an account? </Text>
            <Pressable onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.signInLink}>Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthField({
  icon,
  ...props
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={20} color={colors.grayIcon} />
      <TextInput
        {...props}
        autoCapitalize="none"
        placeholderTextColor={colors.grayIcon}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 38,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  field: {
    height: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 4,
    marginBottom: 10,
  },
  genderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  genderOption: {
    width: '48%',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  genderText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  genderTextSelected: {
    color: '#FFFFFF',
  },
  submit: {
    marginTop: 18,
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  message: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 22,
  },
  signInText: {
    color: colors.muted,
    fontSize: 14,
  },
  signInLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
});
