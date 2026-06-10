import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase mobile env. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env, then restart Expo.',
  );
}

const isWeb = typeof localStorage !== 'undefined';

const CHUNK_SIZE = 2000;

const SecureStoreAdapter = isWeb
  ? {
      getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string) => Promise.resolve(localStorage.setItem(key, value)),
      removeItem: (key: string) => Promise.resolve(localStorage.removeItem(key)),
    }
  : {
      getItem: async (key: string) => {
        const countStr = await SecureStore.getItemAsync(`${key}_n`);
        if (!countStr) return SecureStore.getItemAsync(key);
        const count = parseInt(countStr, 10);
        const chunks: string[] = [];
        for (let i = 0; i < count; i++) {
          const chunk = await SecureStore.getItemAsync(`${key}_${i}`);
          if (chunk === null) return null;
          chunks.push(chunk);
        }
        return chunks.join('');
      },
      setItem: async (key: string, value: string) => {
        if (value.length <= CHUNK_SIZE) {
          await SecureStore.setItemAsync(key, value);
          return;
        }
        const count = Math.ceil(value.length / CHUNK_SIZE);
        await SecureStore.setItemAsync(`${key}_n`, String(count));
        for (let i = 0; i < count; i++) {
          await SecureStore.setItemAsync(`${key}_${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
        }
      },
      removeItem: async (key: string) => {
        const countStr = await SecureStore.getItemAsync(`${key}_n`);
        await SecureStore.deleteItemAsync(key);
        if (!countStr) return;
        const count = parseInt(countStr, 10);
        await SecureStore.deleteItemAsync(`${key}_n`);
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(`${key}_${i}`);
        }
      },
    };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
  },
});
