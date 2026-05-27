import { Redirect } from 'expo-router';

// TODO: check Supabase session and redirect accordingly
export default function Index() {
  return <Redirect href="/(auth)/login" />;
}
