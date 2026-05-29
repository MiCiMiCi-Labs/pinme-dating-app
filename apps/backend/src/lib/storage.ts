import { supabase } from './supabase';

export const BUCKET = 'profile-photos';
export const MAX_PHOTOS = 6;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });
    if (error) {
      console.error('[storage] failed to create bucket:', error.message);
    } else {
      console.log(`[storage] bucket created: ${BUCKET}`);
    }
  }
}
