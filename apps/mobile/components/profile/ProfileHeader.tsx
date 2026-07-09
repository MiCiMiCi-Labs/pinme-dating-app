import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, colors } from '@/design/system';

type Props = { loading: boolean };

export const ProfileHeader = React.memo(function ProfileHeader({ loading }: Props) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>My profile</Text>
        <Text style={styles.subtitle}>
          {loading ? 'Loading profile...' : 'Complete more details to unlock matching.'}
        </Text>
      </View>
      <IconButton icon="settings-outline" />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 18,
    marginBottom: 24,
  },
  title: { color: colors.text, fontSize: 32, fontWeight: '900' },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 250,
  },
});
