import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deletePhoto, getMyPhotos, setPrimaryPhoto, uploadPhoto, type Photo } from '@/lib/api';
import { createPhotoThumbnail, getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { colors, IconButton } from '@/design/system';

const MAX_SLOTS = 6;

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const token = await getToken();
    if (!token) return;
    try {
      setPhotos(await getMyPhotos(token));
    } finally {
      setLoading(false);
    }
  }

  async function handleSlotPress(index: number) {
    const photo = photos[index];
    if (photo) {
      showPhotoActions(photo);
    } else {
      await pickAndUpload(index);
    }
  }

  function showPhotoActions(photo: Photo) {
    const options: Alert['alert'] extends (...args: infer A) => void ? A[2] : never = [
      ...(!photo.isPrimary
        ? [{ text: 'Set as primary', onPress: () => handleSetPrimary(photo.id) }]
        : []),
      {
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () => confirmDelete(photo),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(photo.isPrimary ? 'Primary photo' : 'Photo', undefined, options);
  }

  function confirmDelete(photo: Photo) {
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => handleDelete(photo.id) },
    ]);
  }

  async function pickAndUpload(slotIndex: number) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow access to your photo library to upload photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [3, 4],
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const token = await getToken();
    if (!token) return;

    setUploadingSlot(slotIndex);
    try {
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const thumbnail = await createPhotoThumbnail(asset.uri);
      const photo = await uploadPhoto(token, asset.uri, mimeType, thumbnail);
      setPhotos(prev => [...prev, photo]);
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setUploadingSlot(null);
    }
  }

  async function handleSetPrimary(photoId: string) {
    const token = await getToken();
    if (!token) return;
    setBusyId(photoId);
    try {
      const updated = await setPrimaryPhoto(token, photoId);
      setPhotos(prev =>
        prev.map(p => ({
          ...p,
          isPrimary: p.id === photoId,
          isVerified: p.id === photoId ? updated.isVerified : false,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      Alert.alert('Cannot set as primary', msg || 'Could not update primary photo.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(photoId: string) {
    const token = await getToken();
    if (!token) return;
    setBusyId(photoId);
    try {
      await deletePhoto(token, photoId);
      setPhotos(prev => {
        const remaining = prev.filter(p => p.id !== photoId);
        const deletedWasPrimary = prev.find(p => p.id === photoId)?.isPrimary;
        if (deletedWasPrimary && remaining.length > 0) {
          remaining[0] = { ...remaining[0], isPrimary: true };
        }
        return remaining;
      });
    } catch {
      Alert.alert('Failed', 'Could not delete photo.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <Text style={styles.title}>Photos</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.hint}>Tap a photo to set as primary or delete.</Text>
          <View style={styles.grid}>
            {Array.from({ length: MAX_SLOTS }).map((_, index) => {
              const photo = photos[index];
              const isUploading = uploadingSlot === index;
              const isBusy = photo ? busyId === photo.id : false;

              return (
                <Pressable
                  key={index}
                  style={styles.slot}
                  onPress={() => handleSlotPress(index)}
                  disabled={isUploading || isBusy || (uploadingSlot !== null && !photo)}
                >
                  {photo ? (
                    <>
                      <Image
                        source={{ uri: getDisplayPhotoUrl(photo, 'thumbnail') }}
                        style={styles.photo}
                        contentFit="cover"
                      />
                      {isBusy && (
                        <View style={styles.busyOverlay}>
                          <ActivityIndicator color="#FFFFFF" />
                        </View>
                      )}
                      {photo.isPrimary && (
                        <View style={[styles.badge, photo.isVerified && styles.verifiedBadge]}>
                          {photo.isVerified && (
                            <Ionicons
                              name="checkmark-circle"
                              size={11}
                              color="#FFFFFF"
                              style={{ marginRight: 3 }}
                            />
                          )}
                          <Text style={styles.badgeText}>
                            {photo.isVerified ? 'Verified' : 'Primary'}
                          </Text>
                        </View>
                      )}
                      {!photo.isPrimary && !isBusy && (
                        <View style={styles.starHint}>
                          <Ionicons name="star-outline" size={13} color="#FFFFFF" />
                        </View>
                      )}
                    </>
                  ) : isUploading ? (
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
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerSpacer: { width: 52 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  loader: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
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
  slot: {
    width: '31.3%',
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F4F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
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
