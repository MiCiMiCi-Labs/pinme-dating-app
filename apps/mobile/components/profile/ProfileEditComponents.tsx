import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type KeyboardTypeOptions,
} from 'react-native';
import { colors, PrimaryButton } from '@/design/system';

export type ProfileSectionKey =
  | 'photos'
  | 'essentials'
  | 'about'
  | 'lifestyle'
  | 'relationship'
  | 'interests'
  | 'prompts';

export function ProfileCompletionBar({
  percent,
  compact = false,
}: {
  percent: number;
  compact?: boolean;
}) {
  const width = `${Math.min(Math.max(percent, 0), 100)}%` as DimensionValue;

  return (
    <View style={[styles.completionCard, compact && styles.completionCardCompact]}>
      <View style={styles.completionHeader}>
        <Text style={styles.completionTitle}>Profile completion</Text>
        <Text style={styles.completionPercent}>{percent}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width }]} />
      </View>
    </View>
  );
}

export function ProfileSectionRow({
  title,
  subtitle,
  status,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  status?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.sectionRow} onPress={onPress}>
      <View style={styles.sectionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.sectionText}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {status ? <Text style={styles.sectionStatus}>{status}</Text> : null}
        </View>
        <Text style={styles.sectionSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.grayIcon} />
    </Pressable>
  );
}

export function ProfileField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  helper,
  right,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  helper?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {right}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.grayIcon}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textArea]}
      />
      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

export function SelectField({
  label,
  value,
  placeholder = 'Select',
  options,
  onSelect,
  helper,
  right,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options: string[];
  onSelect: (value: string) => void;
  helper?: string;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const display = value || placeholder;

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {right}
      </View>
      <Pressable style={styles.selectInput} onPress={() => setOpen(current => !current)}>
        <Text style={[styles.selectValue, !value && styles.placeholderText]}>{display}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.grayIcon} />
      </Pressable>
      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
      {open ? (
        <View style={styles.optionPanel}>
          {options.map(option => {
            const selected = option === value;
            return (
              <Pressable
                key={option}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => {
                  onSelect(option);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function MultiSelectField({
  label,
  values,
  options,
  onToggle,
  helper,
  customValue,
  onCustomValueChange,
  onAddCustom,
  right,
}: {
  label: string;
  values: string[];
  options: string[];
  onToggle: (value: string) => void;
  helper?: string;
  customValue?: string;
  onCustomValueChange?: (value: string) => void;
  onAddCustom?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {right}
      </View>
      {helper ? <Text style={[styles.helperText, styles.helperBefore]}>{helper}</Text> : null}
      <View style={styles.chipGrid}>
        {options.map(option => {
          const selected = values.includes(option);
          return (
            <Pressable
              key={option}
              onPress={() => onToggle(option)}
              style={[styles.choiceChip, selected && styles.choiceChipSelected]}
            >
              <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {onAddCustom ? (
        <View style={styles.customRow}>
          <TextInput
            value={customValue}
            onChangeText={onCustomValueChange}
            placeholder="Add your own"
            placeholderTextColor={colors.grayIcon}
            style={styles.customInput}
          />
          <Pressable style={styles.customButton} onPress={onAddCustom}>
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function VisibilityControl({
  visible,
  onChange,
  label = 'Visible on profile',
  locked = false,
}: {
  visible: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  locked?: boolean;
}) {
  return (
    <View style={styles.visibilityRow}>
      <View style={styles.visibilityLabelRow}>
        <Ionicons
          name={visible ? 'eye-outline' : 'eye-off-outline'}
          size={15}
          color={visible ? colors.primary : colors.grayIcon}
        />
        <Text style={styles.visibilityLabel}>{locked ? 'Always visible' : label}</Text>
      </View>
      <Switch
        value={visible}
        disabled={locked}
        onValueChange={onChange}
        trackColor={{ false: '#E4E4EA', true: '#F5B8C1' }}
        thumbColor={visible ? colors.primary : '#FFFFFF'}
      />
    </View>
  );
}

export function PromptCard({
  question,
  answer,
  onPress,
  index,
}: {
  question: string;
  answer: string;
  onPress: () => void;
  index: number;
}) {
  const complete = Boolean(question && answer);
  return (
    <Pressable style={styles.promptCard} onPress={onPress}>
      <View style={styles.promptIcon}>
        <Ionicons name={complete ? 'chatbubble-ellipses' : 'add'} size={17} color={colors.primary} />
      </View>
      <View style={styles.promptText}>
        <Text style={styles.promptQuestion}>{complete ? question : `Add prompt ${index}`}</Text>
        <Text style={styles.promptAnswer} numberOfLines={2}>
          {complete ? answer : 'Choose a prompt and write a short answer.'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.grayIcon} />
    </Pressable>
  );
}

export function ProfileEditSectionModal({
  visible,
  title,
  children,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.modalScreen}>
        <KeyboardAvoidingView
          style={styles.modalKeyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <Pressable style={styles.headerIconButton} onPress={onClose}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>{title}</Text>
            <View style={styles.headerIconButton} />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalContent}
          >
            {children}
          </ScrollView>
          <View style={styles.saveBar}>
            <PrimaryButton onPress={saving ? undefined : onSave}>
              {saving ? <ActivityIndicator color="#FFFFFF" /> : 'Save changes'}
            </PrimaryButton>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  completionCard: {
    borderRadius: 18,
    backgroundColor: '#F7F7FA',
    padding: 16,
    marginTop: 18,
  },
  completionCardCompact: {
    marginTop: 0,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  completionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  completionPercent: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E8E8EE',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  sectionRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#EFEFF4',
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  sectionText: {
    flex: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  sectionStatus: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  fieldBlock: {
    marginBottom: 16,
  },
  fieldHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  fieldLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 54,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#ECECF1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  textArea: {
    minHeight: 118,
    paddingTop: 14,
    lineHeight: 20,
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  helperBefore: {
    marginTop: -2,
    marginBottom: 10,
  },
  selectInput: {
    minHeight: 54,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#ECECF1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  selectValue: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  placeholderText: {
    color: colors.grayIcon,
  },
  optionPanel: {
    marginTop: 8,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#ECECF1',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  optionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F4',
  },
  optionRowSelected: {
    backgroundColor: '#FFF5F7',
  },
  optionText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  choiceChip: {
    minHeight: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E8EE',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  choiceChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  choiceChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  choiceChipTextSelected: {
    color: '#FFFFFF',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  customInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ECECF1',
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  customButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  visibilityRow: {
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: '#F7F7FA',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -2,
    marginBottom: 16,
  },
  visibilityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  visibilityLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  promptCard: {
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ECECF1',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 12,
  },
  promptIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  promptText: {
    flex: 1,
  },
  promptQuestion: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  promptAnswer: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: '#F7F7FA',
  },
  modalKeyboard: {
    flex: 1,
  },
  modalHeader: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#F7F7FA',
  },
  headerIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 110,
  },
  saveBar: {
    borderTopWidth: 1,
    borderTopColor: '#ECECF1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
  },
});
