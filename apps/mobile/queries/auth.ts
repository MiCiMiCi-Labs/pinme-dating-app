import { useAuth } from '@/contexts/auth';

export function useAccessToken() {
  const { session } = useAuth();
  return session?.access_token ?? null;
}

export function useAuthUserId() {
  const { session } = useAuth();
  return session?.user.id ?? null;
}
