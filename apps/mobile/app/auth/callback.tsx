import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/design/system';
import { supabase } from '@/lib/supabase';

// Expo Router navigates here directly because this is the literal path
// encoded in the OAuth redirectTo (see oauthRedirectTo in (auth)/login.tsx —
// Linking.createURL('auth/callback')). Without a real route file at this
// path, the router has nothing to match and falls back to its "Unmatched
// Route" screen. This screen's only job is to extract the tokens Supabase
// appended to the URL and hand them to Supabase's client; once the session
// updates, RootNavigator (app/_layout.tsx) takes over and replaces this
// screen with complete-profile or discover.
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

export default function AuthCallbackScreen() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handle(url: string | null) {
      if (!url) return;

      const { accessToken, refreshToken, error: oauthError } = getOAuthParams(url);

      if (oauthError) {
        setError(oauthError);
        return;
      }

      if (!accessToken || !refreshToken) return;

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) setError(sessionError.message);
    }

    Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));

    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  },
  error: {
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
  },
});
