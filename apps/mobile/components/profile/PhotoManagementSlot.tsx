import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/design/system';
import { getDisplayPhotoUrl } from '@/lib/photos';
import type { Photo } from './types';

export type SlotState =
  | { kind: 'photo'; photo: Photo; isBusy: boolean }
  | { kind: 'uploading' }
  | { kind: 'empty' };

type Props = {
  slot: SlotState;
  disabled: boolean;
  onPress: () => void;
};

export const PhotoManagementSlot = React.memo(function PhotoManagementSlot({
  slot,
  disabled,
  onPress,
}: Props) {
  return (
    <Pressable style={styles.slot} onPress={onPress} disabled={disabled}>
      {slot.kind === 'photo' ? (
        <>
          <Image
            source={{ uri: getDisplayPhotoUrl(slot.photo, 'thumbnail') }}
            style={styles.photo}
            contentFit="cover"
          />
          {slot.isBusy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          )}
          {slot.photo.isPrimary && (
            <View style={[styles.badge, slot.photo.isVerified && styles.verifiedBadge]}>
              {slot.photo.isVerified && (
                <Ionicons name="checkmark-circle" size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
              )}
              <Text style={styles.badgeText}>
                {slot.photo.isVerified ? 'Verified' : 'Primary'}
              </Text>
            </View>
          )}
          {!slot.photo.isPrimary && !slot.isBusy && (
            <View style={styles.starHint}>
              <Ionicons name="star-outline" size={13} color="#FFFFFF" />
            </View>
          )}
        </>
      ) : slot.kind === 'uploading' ? (
        <View style={styles.emptySlot}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={styles.emptySlot}>
          <Ionicons name="add" size={26} color={colors.grayIcon} />
          <Text style={styles.emptyText}>Add photo</Text>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  slot: {
    width: '31.3%',
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F4F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECF1',
  },
  photo: { width: '100%', height: '100%' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedBadge: { backgroundColor: '#22C55E' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  starHint: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  emptyText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
});
