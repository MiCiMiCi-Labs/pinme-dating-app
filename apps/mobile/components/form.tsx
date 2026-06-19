import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

export function EditableField({
  label,
  value,
  onChangeText,
  rightAccessory,
}: {
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  rightAccessory?: React.ReactNode;
}) {
  const inputRef = useRef<TextInput>(null);
  const editable = Boolean(onChangeText);

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {rightAccessory ? <View style={styles.fieldAccessory}>{rightAccessory}</View> : null}
      </View>
      <Pressable
        style={[styles.field, !editable && styles.fieldReadOnly]}
        onPress={() => {
          if (editable) {
            inputRef.current?.focus();
          }
        }}
      >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        style={styles.input}
      />
      </Pressable>
    </View>
  );
}

export function EditableTextArea({
  label,
  value,
  onChangeText,
  placeholder,
  rightAccessory,
}: {
  label?: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  rightAccessory?: React.ReactNode;
}) {
  const inputRef = useRef<TextInput>(null);
  const editable = Boolean(onChangeText);
  const hasHeader = Boolean(label || rightAccessory);

  return (
    <View style={[styles.textAreaBlock, !hasHeader && styles.textAreaBlockNoHeader]}>
      {hasHeader ? (
        <View style={styles.fieldHeader}>
          {label ? <Text style={styles.fieldLabel}>{label}</Text> : <View />}
          {rightAccessory ? <View style={styles.fieldAccessory}>{rightAccessory}</View> : null}
        </View>
      ) : null}
      <Pressable
        style={styles.textArea}
        onPress={() => {
          if (editable) {
            inputRef.current?.focus();
          }
        }}
      >
        <TextInput
          ref={inputRef}
          multiline
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={styles.textAreaInput}
        />
      </Pressable>
    </View>
  );
}

export function PhotoUploadGrid({
  photos,
  primaryVerified = false,
}: {
  photos: Array<string | null>;
  primaryVerified?: boolean;
}) {
  return (
    <Pressable onPress={() => router.push('/(main)/profile/photos')}>
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
            <View style={[styles.primaryBadge, primaryVerified && styles.verifiedBadge]}>
              {primaryVerified && (
                <Ionicons name="checkmark-circle" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
              )}
              <Text style={styles.primaryBadgeText}>
                {primaryVerified ? 'Photo Verified' : 'Primary'}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
    </Pressable>
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
  fieldBlock: {
    marginBottom: 12,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
    flex: 1,
  },
  fieldAccessory: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  field: {
    minHeight: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  fieldReadOnly: {
    backgroundColor: '#F7F7F9',
  },
  input: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
  },
  textAreaBlock: {
    marginBottom: 12,
  },
  textAreaBlockNoHeader: {
    marginTop: 12,
  },
  textArea: {
    minHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    backgroundColor: '#FFFFFF',
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedBadge: {
    backgroundColor: '#22C55E',
  },
  primaryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
});
