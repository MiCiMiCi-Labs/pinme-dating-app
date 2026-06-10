import { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/contexts/auth';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading, profileComplete, profileCompletionLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!loading && !profileCompletionLoading) SplashScreen.hideAsync();
  }, [loading, profileCompletionLoading]);

  useEffect(() => {
    if (loading || profileCompletionLoading) return;

    const inMain = segments[0] === '(main)';
    const inAuth = segments[0] === '(auth)';
    const inCompleteProfile = inAuth && segments[1] === 'complete-profile';

    if (!session) {
      if (inMain) {
        router.replace('/');
      } else if (inCompleteProfile) {
        router.replace('/(auth)/login');
      }
      return;
    }

    if (!profileComplete) {
      if (!inCompleteProfile) {
        router.replace('/(auth)/complete-profile');
      }
      return;
    }

    if (!inMain) {
      router.replace('/(main)/discover');
    }
  }, [session, loading, profileComplete, profileCompletionLoading, segments]);

  if (loading || profileCompletionLoading) return null;

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
