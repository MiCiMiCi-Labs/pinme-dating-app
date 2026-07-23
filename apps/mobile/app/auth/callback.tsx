import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, PrimaryButton } from '@/design/system';

// Expo Router navigates here directly because this is the literal path
// encoded in the OAuth redirectTo (see oauthRedirectTo in (auth)/login.tsx —
// Linking.createURL('auth/callback')). Without a real route file at this
// path, the router has nothing to match and falls back to its "Unmatched
// Route" screen.
//
// The actual token exchange happens in OAuthCallbackListener, mounted at the
// app root (app/_layout.tsx) — not here. A listener registered only once
// this screen mounts would already have missed the very 'url' event that
// caused Expo Router to navigate here in the first place, on any warm
// app re-open (the app already running, mid OAuth) rather than a cold
// start. This screen just waits for AuthProvider's session to update;
// RootNavigator's existing effect then carries the user away to
// complete-profile or discover on its own. If that never happens, show a
// timeout instead of sitting on an indefinite blank screen.
const TIMEOUT_MS = 10_000;

export default function AuthCallbackScreen() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <View style={styles.screen}>
      {timedOut ? (
        <>
          <Text style={styles.error}>Sign-in didn't finish. Please go back and try again.</Text>
          <PrimaryButton onPress={() => router.replace('/(auth)/login')} style={styles.button}>
            Back to login
          </PrimaryButton>
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
    gap: 20,
  },
  error: {
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
  },
  button: {
    minWidth: 180,
  },
});
