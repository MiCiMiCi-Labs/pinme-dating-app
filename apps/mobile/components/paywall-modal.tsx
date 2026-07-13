import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, PrimaryButton } from '@/design/system';

type PaywallModalProps = {
  visible: boolean;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onRedeem: (code: string) => void;
};

export function PaywallModal({
  visible,
  loading = false,
  error,
  onClose,
  onRedeem,
}: PaywallModalProps) {
  const [code, setCode] = useState('');

  const submit = () => {
    const trimmed = code.trim();
    if (!trimmed || loading) return;
    onRedeem(trimmed);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.card}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="heart" size={28} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>See who liked you</Text>
          <Text style={styles.copy}>
            Unlock secret admirers, faster matches, and premium discovery tools.
          </Text>

          <View style={styles.featureRow}>
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <Text style={styles.featureText}>Reveal people already interested in you</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="flash" size={18} color={colors.primary} />
            <Text style={styles.featureText}>Match faster from your likes list</Text>
          </View>

          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Promo code"
            placeholderTextColor={colors.grayIcon}
            style={styles.input}
            editable={!loading}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton onPress={submit} style={styles.button}>
            {loading ? <ActivityIndicator color="#FFFFFF" /> : 'Apply code'}
          </PrimaryButton>
          <Pressable onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Maybe later</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 17, 22, 0.48)',
  },
  card: {
    borderRadius: 28,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 22,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
    marginTop: 18,
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 18,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  featureText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    height: 54,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#FBFBFC',
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  button: {
    marginTop: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  secondaryText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
});
