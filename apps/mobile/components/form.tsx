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
  const filledCount = photos.filter(Boolean).length;
  const displaySlots = photos.slice(0, 4);
  const overflowCount = filledCount > 4 ? filledCount - 4 : 0;

  const subtitle = (() => {
    if (filledCount === 0) return 'Add at least 3 photos to start matching';
    if (filledCount === 1) return '1 photo · add 2 more to unlock matching';
    if (filledCount === 2) return '2 photos · add 1 more to unlock matching';
    return `${filledCount} photos added`;
  })();

  return (
    <Pressable style={styles.photoCard} onPress={() => router.push('/(main)/profile/photos')}>
      <View style={styles.photoCardHeader}>
        <Text style={styles.photoTitle}>Photos</Text>
        <View style={styles.manageBtn}>
          <Text style={styles.manageBtnText}>Manage</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </View>
      </View>
      <Text style={styles.photoSubtitle}>{subtitle}</Text>
      <View style={styles.photoRow}>
        {displaySlots.map((photo, index) => {
          const showOverflow = index === 3 && overflowCount > 0;
          return (
            <View key={`photo-slot-${index}`} style={styles.photoTile}>
              {photo ? (
                <>
                  <Image source={{ uri: photo }} style={styles.tileImage} contentFit="cover" />
                  {index === 0 && (
                    <View style={[styles.tileBadge, primaryVerified && styles.tileBadgeVerified]}>
                      {primaryVerified && (
                        <Ionicons name="checkmark-circle" size={10} color="#FFFFFF" style={{ marginRight: 3 }} />
                      )}
                      <Text style={styles.tileBadgeText}>{primaryVerified ? 'Verified' : 'Main'}</Text>
                    </View>
                  )}
                  {showOverflow && (
                    <View style={styles.overflowOverlay}>
                      <Text style={styles.overflowText}>+{overflowCount}</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.tileEmpty}>
                  <Ionicons name="add" size={20} color={colors.primary} />
                </View>
              )}
            </View>
          );
        })}
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
  photoCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 18,
  },
  photoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  manageBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  photoSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 7,
  },
  photoTile: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F4F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    borderRadius: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tileBadgeVerified: {
    backgroundColor: '#22C55E',
  },
  tileBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  overflowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
});
