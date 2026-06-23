import { supabase } from './supabase';

export const BUCKET = 'profile-photos';
export const MAX_PHOTOS = 6;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const VOICE_BUCKET = 'voice-messages';
export const ALLOWED_AUDIO_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/x-m4a'];
export const MAX_VOICE_SIZE = 10 * 1024 * 1024;

export const CHAT_MEDIA_BUCKET = 'chat-media';
export const ALLOWED_CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/mpeg'];
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

export async function ensureChatMediaBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (!exists) {
    // TODO: switch to private: true and serve via signed URLs (createSignedUrl) once
    // user-level access control is required. Currently public for MVP simplicity.
    const { error } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: MAX_VIDEO_SIZE,
    });
    if (error) {
      console.error('[storage] failed to create chat-media bucket:', error.message);
    } else {
      console.log(`[storage] bucket created: ${CHAT_MEDIA_BUCKET}`);
    }
  }
}

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
