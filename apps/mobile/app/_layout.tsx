import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Animated, Easing, LogBox, StyleSheet, Text, View } from 'react-native';
import { GlobalToastHost } from '@/components/global-toast';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { colors } from '@/design/system';
import { resetChatEvents } from '@/stores/chatEvents.store';
import { resetDiscoveryUi } from '@/stores/discoveryUi.store';
import { resetHiddenLikedUsers } from '@/stores/likedYou.store';
import { resetProfileCompletion } from '@/stores/profileCompletion.store';
import { resetVoiceRoomState } from '@/stores/voiceRoom.store';

SplashScreen.preventAutoHideAsync();

if (__DEV__) {
  LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered.']);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnMount: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});

function RootNavigator() {
  const { session, loading, profileComplete, profileCompletionLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

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

  if (loading || profileCompletionLoading) return <LoadingScreen />;

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

function AuthCacheBoundary() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const currentUserId = session?.user.id ?? null;
    const previousUserId = previousUserIdRef.current;

    if (previousUserId !== undefined && previousUserId !== currentUserId) {
      queryClient.clear();
      resetChatEvents();
      resetDiscoveryUi();
      resetHiddenLikedUsers();
      resetProfileCompletion();
      resetVoiceRoomState();
    }

    previousUserIdRef.current = currentUserId;
  }, [queryClient, session?.user.id]);

  return null;
}

function LoadingScreen() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.18,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 520,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [scale]);

  return (
    <View style={styles.loadingScreen}>
      <Animated.Text style={[styles.loadingHeart, { transform: [{ scale }] }]}>♥</Animated.Text>
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthCacheBoundary />
        <RootNavigator />
        <GlobalToastHost />
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: 14,
  },
  loadingHeart: {
    color: colors.primary,
    fontSize: 54,
    lineHeight: 60,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
});
