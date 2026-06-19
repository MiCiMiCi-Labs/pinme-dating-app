import { useEffect, useRef } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { colors } from '@/design/system';

SplashScreen.preventAutoHideAsync();

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
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
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
