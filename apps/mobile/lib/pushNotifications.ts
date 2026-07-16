import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken } from './api';

type ExpoNotificationsModule = typeof import('expo-notifications');

let notificationsModulePromise: Promise<ExpoNotificationsModule | null> | null = null;

async function loadNotifications() {
  if (Platform.OS === 'web') return null;

  notificationsModulePromise ??= import('expo-notifications')
    .then((module) => {
      module.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      return module;
    })
    .catch((error) => {
      console.warn('[push] expo-notifications is not available in this build:', error);
      return null;
    });

  return notificationsModulePromise;
}

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  );
}

export async function registerForPushNotifications(accessToken: string) {
  if (Platform.OS === 'web') return null;

  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  const existingPermission = await Notifications.getPermissionsAsync();
  let finalStatus = existingPermission.status;

  if (finalStatus !== 'granted') {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E64C61',
    });
  }

  const projectId = getProjectId();
  if (!projectId) {
    console.warn('[push] Missing EAS project id. Cannot register push token.');
    return null;
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushToken(accessToken, {
    token: data,
    platform: Platform.OS,
  });

  return data;
}
