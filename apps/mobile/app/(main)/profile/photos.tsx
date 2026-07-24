import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { deletePhoto, getMyPhotos, setPrimaryPhoto, uploadPhoto, type Photo } from '@/lib/api';
import { createPhotoThumbnail } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { colors } from '@/design/system';
import { PhotosHeader } from '@/components/profile/PhotosHeader';
import { PhotoManagementGrid } from '@/components/profile/PhotoManagementGrid';
import { useAuthUserId } from '@/queries/auth';
import { queryKeys } from '@/queries/keys';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const userId = useAuthUserId();

  function invalidateMyPhotos() {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.myPhotos(userId) });
  }

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
      { text: 'Delete', style: 'destructive' as const, onPress: () => confirmDelete(photo) },
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
      invalidateMyPhotos();
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
      invalidateMyPhotos();
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
      invalidateMyPhotos();
    } catch {
      Alert.alert('Failed', 'Could not delete photo.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <PhotosHeader onBack={() => router.back()} />
      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PhotoManagementGrid
            photos={photos}
            uploadingSlot={uploadingSlot}
            busyId={busyId}
            onSlotPress={handleSlotPress}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
});
