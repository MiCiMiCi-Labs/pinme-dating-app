import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/design/system';
import type { Photo } from './types';
import { PhotoManagementSlot, type SlotState } from './PhotoManagementSlot';

const MAX_SLOTS = 6;

type Props = {
  photos: Photo[];
  uploadingSlot: number | null;
  busyId: string | null;
  onSlotPress: (index: number) => void;
};

export const PhotoManagementGrid = React.memo(function PhotoManagementGrid({
  photos,
  uploadingSlot,
  busyId,
  onSlotPress,
}: Props) {
  return (
    <View>
      <Text style={styles.hint}>Tap a photo to set as primary or delete.</Text>
      <View style={styles.grid}>
        {Array.from({ length: MAX_SLOTS }).map((_, index) => {
          const photo = photos[index] ?? null;
          const isUploading = uploadingSlot === index;
          const isBusy = photo ? busyId === photo.id : false;
          const disabled = isUploading || isBusy || (uploadingSlot !== null && !photo);

          let slot: SlotState;
          if (photo) {
            slot = { kind: 'photo', photo, isBusy };
          } else if (isUploading) {
            slot = { kind: 'uploading' };
          } else {
            slot = { kind: 'empty' };
          }

          return (
            <PhotoManagementSlot
              key={index}
              slot={slot}
              disabled={disabled}
              onPress={() => onSlotPress(index)}
            />
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
