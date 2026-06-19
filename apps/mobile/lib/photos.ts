import * as ImageManipulator from 'expo-image-manipulator';

const thumbnailWidth = 720;
const thumbnailQuality = 0.72;

export async function createPhotoThumbnail(uri: string) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: thumbnailWidth } }],
    {
      compress: thumbnailQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  return {
    uri: result.uri,
    mimeType: 'image/jpeg',
  };
}

export function getDisplayPhotoUrl(
  photo: { url: string; thumbnailUrl?: string | null },
  preferred: 'thumbnail' | 'original' = 'thumbnail'
) {
  if (preferred === 'original') return photo.url;
  return photo.thumbnailUrl ?? photo.url;
}
