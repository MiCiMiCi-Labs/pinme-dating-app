import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/design/system';
import { matchingProfileCompletionThreshold } from '@/lib/profileCompleteness';
import { SkeletonBox } from './ProfileSkeleton';

type Props = { percent: number; loading: boolean };

export const ProfileStrengthCard = React.memo(function ProfileStrengthCard({ percent, loading }: Props) {
  if (loading) {
    return (
      <View style={styles.card}>
        <SkeletonBox style={{ height: 18, width: '40%', marginBottom: 12 }} />
        <SkeletonBox style={{ height: 8, borderRadius: 8 }} />
        <SkeletonBox style={{ height: 14, width: '70%', marginTop: 10 }} />
      </View>
    );
  }

  const canStartMatching = percent >= matchingProfileCompletionThreshold;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.title}>Profile strength</Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.copy}>
        {canStartMatching
          ? 'You can enter the matching page now.'
          : `Reach ${matchingProfileCompletionThreshold}% to start matching.`}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 18,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '900' },
  percent: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  track: {
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 12,
  },
  fill: { height: '100%', borderRadius: 8, backgroundColor: colors.primary },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
