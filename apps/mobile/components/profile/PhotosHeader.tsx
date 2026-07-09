import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, IconButton } from '@/design/system';

type Props = { onBack: () => void };

export const PhotosHeader = React.memo(function PhotosHeader({ onBack }: Props) {
  return (
    <View style={styles.header}>
      <IconButton icon="chevron-back" onPress={onBack} />
      <Text style={styles.title}>Photos</Text>
      <View style={styles.spacer} />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  spacer: { width: 52 },
});
