import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Animated, Easing, LogBox, StyleSheet, Text, View } from 'react-native';
import { GlobalToastHost } from '@/components/global-toast';
import { GlobalCallHost } from '@/components/global-call-host';
import { IosVoipCallKitCoordinator } from '@/components/ios-voip-callkit-coordinator';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { CallProvider } from '@/contexts/call';
import { colors } from '@/design/system';
import { resetSwipedUsers } from '@/lib/swipedUsers';
import { supabase } from '@/lib/supabase';
import { resetChatEvents } from '@/stores/chatEvents.store';
import { resetDiscoveryUi } from '@/stores/discoveryUi.store';
import { resetHiddenLikedUsers } from '@/stores/likedYou.store';
import { resetProfileCompletion } from '@/stores/profileCompletion.store';
import { showToast } from '@/stores/toast.store';
import { resetVoiceRoomState } from '@/stores/voiceRoom.store';

SplashScreen.preventAutoHideAsync();

if (__DEV__) {
  LogBox.ignoreLogs([
    'Sending `onAnimatedValueUpdate` with no listeners registered.',
    // Benign teardown race, private-call end only: CallKit's own native
    // audio-session cleanup and LiveKit's internal registerGlobals()-driven
    // stopAudioSession() (see lib/callAudioCoordinator.ts's ownership notes)
    // both try to deactivate the same AVAudioSession when a CallKit-managed
    // call ends — whichever runs second finds it already inactive. Call
    // teardown and the next call both proceed normally; this is LiveKit's
    // own logged rejection, not a thrown/unhandled error.
    'AudioSession configuration failed, stopping audio engine',
  ]);
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
    const inCompleteProfile =
      segments[0] === 'complete-profile' || (inAuth && segments[1] === 'complete-profile');

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
        router.replace('/complete-profile');
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
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="complete-profile" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </>
  );
}

function getOAuthParams(url: string) {
  const [, hash = ''] = url.split('#');
  const [, query = ''] = url.split('?');
  const params = new URLSearchParams(hash || query);

  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    error: params.get('error_description') ?? params.get('error'),
  };
}

// Must live here, mounted for the app's entire lifetime, rather than inside
// app/auth/callback.tsx itself. Expo Router only navigates to that screen
// *because* it saw the same incoming 'url' event this needs to read — by
// the time that screen mounts and registers its own listener, a same-tick
// native event has already finished dispatching to whichever listeners
// existed at that moment. Linking.getInitialURL() covers a cold app launch,
// but a warm re-open (app already running, e.g. mid Google OAuth) only ever
// fires the live event, which a listener registered this late will always
// miss. Registering here instead means it's already listening before any
// redirect could possibly happen.
function OAuthCallbackListener() {
  const handledUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    async function handle(url: string | null) {
      if (!url) return;
      // Ignore any deep link that isn't our own OAuth redirect.
      if (!url.includes('access_token') && !url.includes('error')) return;
      // getInitialURL() and a same-tick 'url' event can both deliver the
      // exact same cold-start URL — only act on it once.
      if (handledUrlsRef.current.has(url)) return;
      handledUrlsRef.current.add(url);

      const { accessToken, refreshToken, error: oauthError } = getOAuthParams(url);

      if (oauthError) {
        showToast(oauthError, 'error');
        return;
      }

      if (!accessToken || !refreshToken) return;

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) showToast(sessionError.message, 'error');
      // On success, AuthProvider's session state updates and RootNavigator's
      // existing effect below carries the user away from auth/callback to
      // complete-profile or discover — nothing else to do here.
    }

    Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));

    return () => subscription.remove();
  }, []);

  return null;
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
      resetSwipedUsers();
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
        <OAuthCallbackListener />
        <CallProvider>
          <RootNavigator />
          <GlobalCallHost />
          <IosVoipCallKitCoordinator />
        </CallProvider>
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
