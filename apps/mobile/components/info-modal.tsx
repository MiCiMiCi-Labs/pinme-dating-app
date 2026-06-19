import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/design/system';

type InfoModalProps = {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export function InfoModal({
  visible,
  title,
  message,
  onClose,
}: InfoModalProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.card}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 17, 22, 0.42)',
  },
  card: {
    borderRadius: 24,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    paddingRight: 32,
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
  },
});
