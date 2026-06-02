import { Image } from 'expo-image';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/design/system';

export function FormSection({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      {children}
    </View>
  );
}

export function EditableField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} style={styles.input} />
    </View>
  );
}

export function EditableTextArea({ value }: { value: string }) {
  return (
    <View style={styles.textArea}>
      <TextInput multiline value={value} style={styles.textAreaInput} />
    </View>
  );
}

export function PhotoUploadGrid({ photos }: { photos: Array<string | null> }) {
  return (
    <View style={styles.photoGrid}>
      {photos.map((photo, index) => (
        <View key={`${photo ?? 'empty'}-${index}`} style={[styles.photoSlot, index === 0 && styles.primaryPhoto]}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
          ) : (
            <View style={styles.addPhoto}>
              <Ionicons name="add" size={26} color={colors.primary} />
              <Text style={styles.addText}>Upload</Text>
            </View>
          )}
          {index === 0 ? (
            <View style={styles.primaryBadge}>
              <Text style={styles.primaryBadgeText}>Primary</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  helper: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 14,
  },
  field: {
    minHeight: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
  },
  textArea: {
    minHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginTop: 12,
  },
  textAreaInput: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
    padding: 0,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoSlot: {
    width: '31.3%',
    aspectRatio: 0.78,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: '#FAFAFB',
  },
  primaryPhoto: {
    width: '64.2%',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  addPhoto: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  primaryBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    borderRadius: 9,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  primaryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
});
