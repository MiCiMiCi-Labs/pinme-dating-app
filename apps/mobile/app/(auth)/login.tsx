import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { colors, IconButton, PrimaryButton } from '@/design/system';

export default function LoginScreen() {
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [code, setCode] = useState(['7', '2', '', '']);
  const { height } = useWindowDimensions();
  const numberTop = Math.min(height * 0.2, 168);

  if (step === 'code') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.topBar}>
          <IconButton icon="chevron-back" onPress={() => setStep('number')} />
        </View>
        <View style={styles.codeHeader}>
          <Text style={styles.timer}>00:42</Text>
          <Text style={styles.codeCopy}>Type the verification code{'\n'}we’ve sent you</Text>
        </View>
        <View style={styles.codeBoxes}>
          {code.map((value, index) => (
            <View key={index} style={[styles.codeBox, value ? styles.codeBoxFilled : null]}>
              <Text style={[styles.codeText, value ? styles.codeTextFilled : null]}>
                {value || '0'}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace-outline'].map(
            (item, index) => (
              <Pressable
                key={`${item}-${index}`}
                style={styles.key}
                onPress={() => {
                  if (!item) return;
                  if (item === 'backspace-outline') {
                    const next = [...code];
                    const lastFilled = next.map(Boolean).lastIndexOf(true);
                    if (lastFilled >= 0) next[lastFilled] = '';
                    setCode(next);
                    return;
                  }
                  const next = [...code];
                  const empty = next.findIndex((digit) => !digit);
                  if (empty >= 0) next[empty] = item;
                  setCode(next);
                  if (next.every(Boolean)) router.replace('/(main)/discover');
                }}
              >
                {item === 'backspace-outline' ? (
                  <Ionicons name="backspace-outline" size={24} color={colors.text} />
                ) : (
                  <Text style={styles.keyText}>{item}</Text>
                )}
              </Pressable>
            )
          )}
        </View>
        <Pressable style={styles.resend}>
          <Text style={styles.resendText}>Send again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.numberContent, { paddingTop: numberTop }]}>
        <Text style={styles.title}>My mobile</Text>
        <Text style={styles.copy}>
          Please enter your valid phone number. We will send you a 4-digit code to verify your
          account.
        </Text>
        <View style={styles.phoneInput}>
          <Text style={styles.flag}>🇺🇸</Text>
          <Text style={styles.country}>(+1)</Text>
          <Ionicons name="chevron-down" size={16} color={colors.grayIcon} />
          <View style={styles.inputDivider} />
          <TextInput
            value="331 623 8413"
            style={styles.input}
            keyboardType="phone-pad"
            placeholderTextColor={colors.grayIcon}
          />
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton onPress={() => setStep('code')}>Continue</PrimaryButton>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 40,
  },
  topBar: {
    paddingTop: 22,
  },
  numberContent: {
    flex: 1,
    justifyContent: 'flex-start',
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
  },
  phoneInput: {
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    marginTop: 34,
    gap: 8,
  },
  flag: {
    fontSize: 20,
  },
  country: {
    color: colors.text,
    fontSize: 14,
  },
  inputDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.line,
    marginHorizontal: 12,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  footer: {
    paddingBottom: 44,
  },
  codeHeader: {
    alignItems: 'center',
    marginTop: 28,
  },
  timer: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '900',
  },
  codeCopy: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 25,
    marginTop: 14,
  },
  codeBoxes: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 36,
  },
  codeBox: {
    width: 68,
    height: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  codeText: {
    color: '#E4B2B9',
    fontSize: 34,
    fontWeight: '900',
  },
  codeTextFilled: {
    color: '#FFFFFF',
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 42,
  },
  key: {
    width: '33.333%',
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    color: colors.text,
    fontSize: 26,
  },
  resend: {
    alignItems: 'center',
    marginTop: 24,
    paddingBottom: 26,
  },
  resendText: {
    color: colors.primary,
    fontWeight: '900',
    fontSize: 16,
  },
});
