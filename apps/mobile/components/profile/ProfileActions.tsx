import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PrimaryButton } from '@/design/system';

type Props = {
  saving: boolean;
  onSave: () => void;
};

export const ProfileActions = React.memo(function ProfileActions({ saving, onSave }: Props) {
  return (
    <View style={styles.actionBar}>
      <PrimaryButton variant="outline">Preview</PrimaryButton>
      <PrimaryButton onPress={onSave}>{saving ? 'Saving...' : 'Save changes'}</PrimaryButton>
    </View>
  );
});

const styles = StyleSheet.create({
  actionBar: { gap: 14, marginTop: 30 },
});
