import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PhotoUploadGrid } from '@/components/form';
import { SkeletonBox } from './ProfileSkeleton';

type Props = {
  photos: Array<string | null>;
  primaryVerified: boolean;
  loading: boolean;
};

export const PhotoSummary = React.memo(function PhotoSummary({ photos, primaryVerified, loading }: Props) {
  if (loading) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SkeletonBox style={{ height: 16, width: 70 }} />
          <SkeletonBox style={{ height: 14, width: 60 }} />
        </View>
        <SkeletonBox style={{ height: 12, width: '60%', marginBottom: 10 }} />
        <View style={styles.tileRow}>
          {[0, 1, 2, 3].map(i => (
            <SkeletonBox key={i} style={styles.tile} />
          ))}
        </View>
      </View>
    );
  }

  return <PhotoUploadGrid photos={photos} primaryVerified={primaryVerified} />;
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tileRow: { flexDirection: 'row', gap: 7 },
  tile: { flex: 1, aspectRatio: 3 / 4, borderRadius: 10 },
});
