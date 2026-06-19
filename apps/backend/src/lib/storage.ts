import { supabase } from './supabase';

export const BUCKET = 'profile-photos';
export const MAX_PHOTOS = 6;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const VOICE_BUCKET = 'voice-messages';
export const ALLOWED_AUDIO_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/x-m4a'];
export const MAX_VOICE_SIZE = 10 * 1024 * 1024; // 10MB

export async function ensureVoiceBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === VOICE_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(VOICE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_VOICE_SIZE,
    });
    if (error) {
      console.error('[storage] failed to create voice bucket:', error.message);
    } else {
      console.log(`[storage] bucket created: ${VOICE_BUCKET}`);
    }
  }
}

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
