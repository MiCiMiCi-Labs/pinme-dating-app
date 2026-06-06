import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

function getProfileCompletionKey(userId: string) {
  return `pinme.profileComplete.${userId}`;
}

export async function getProfileCompletion(userId: string) {
  const key = getProfileCompletionKey(userId);

  if (Platform.OS === 'web') {
    return localStorage.getItem(key) === 'true';
  }

  return (await SecureStore.getItemAsync(key)) === 'true';
}

export async function setProfileCompletion(userId: string, complete: boolean) {
  const key = getProfileCompletionKey(userId);
  const value = complete ? 'true' : 'false';

  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}
