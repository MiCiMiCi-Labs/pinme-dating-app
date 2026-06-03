import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { EditableField, EditableTextArea, FormSection, PhotoUploadGrid } from '@/components/form';
import { colors, IconButton, PrimaryButton } from '@/design/system';
import { myPhotoSlots, myProfileFields, myProfilePrompts } from '@/data/mock';
import { supabase } from '@/lib/supabase';

export default function MyProfileScreen() {
  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My profile</Text>
            <Text style={styles.subtitle}>Photos, personal details, and dating preferences</Text>
          </View>
          <IconButton icon="settings-outline" />
        </View>

        <PhotoUploadGrid photos={myPhotoSlots} />

        <FormSection
          title="Basic profile"
          helper="These fields sync with your backend profile and user record."
        >
          {myProfileFields.map(([label, value]) => (
            <EditableField key={label} label={label} value={value} />
          ))}
        </FormSection>

        <FormSection title="Bio">
          <EditableTextArea value="I’m building a life with more travel, better coffee, and someone who can make ordinary days feel special." />
        </FormSection>

        <FormSection title="Prompts">
          {myProfilePrompts.map(([label, value]) => (
            <EditableTextArea key={label} value={`${label}\n${value}`} />
          ))}
        </FormSection>

        <View style={styles.actionBar}>
          <PrimaryButton variant="outline">Preview</PrimaryButton>
          <PrimaryButton>Save changes</PrimaryButton>
        </View>

        <View style={styles.logoutSection}>
          <PrimaryButton variant="soft" onPress={logout}>
            Log out
          </PrimaryButton>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 54,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 18,
    marginBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 250,
  },
  actionBar: {
    gap: 12,
    marginTop: 28,
  },
  logoutSection: {
    marginTop: 16,
  },
});
