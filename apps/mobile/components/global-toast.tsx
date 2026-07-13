import { useStore } from '@nanostores/react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/design/system';
import { $toast, hideToast } from '@/stores/toast.store';

const toastColors = {
  success: '#16A34A',
  error: '#DC2626',
  info: colors.text,
};

export function GlobalToastHost() {
  const toast = useStore($toast);

  if (!toast.visible) return null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={hideToast}
      style={[styles.toast, { backgroundColor: toastColors[toast.type] }]}
    >
      <Text style={styles.text}>{toast.message}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 42,
    zIndex: 999,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});
