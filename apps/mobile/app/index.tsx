import { Redirect } from 'expo-router';

// One unified entry point for both new and returning users — phone number
// (OTP) and Apple/Google/Facebook, no separate "create account" vs "sign in"
// choice and no password (matches Tinder/Soul-style onboarding). Whether the
// person is new is decided after auth, not before: RootNavigator
// (app/_layout.tsx) already routes a signed-in user with an incomplete
// profile to (auth)/complete-profile's step 1-6 wizard, and a signed-in user
// with a complete one straight to (main)/discover.
export default function Index() {
  return <Redirect href="/(auth)/login" />;
}
