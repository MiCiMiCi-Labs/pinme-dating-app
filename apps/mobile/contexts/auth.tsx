import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  ApiError,
  getMyProfile,
  type AppProfile,
  type AppUser,
} from '@/lib/api';
import { registerForPushNotifications } from '@/lib/pushNotifications';

type AuthContextType = {
  session: Session | null;
  loading: boolean;
  profileComplete: boolean;
  profileCompletionLoading: boolean;
  refreshProfileCompletion: () => Promise<boolean>;
  markProfileComplete: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  profileComplete: false,
  profileCompletionLoading: true,
  refreshProfileCompletion: async () => false,
  markProfileComplete: async () => false,
});

function hasCompleteProfile(
  user: Omit<AppUser, 'profile'>,
  profile: AppProfile | null
) {
  return Boolean(
    user.name?.trim() &&
      user.birthday &&
      user.gender &&
      user.city?.trim() &&
      user.bio?.trim() &&
      profile?.relationshipGoal
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileCompletionLoading, setProfileCompletionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut();
        setProfileCompletionLoading(false);
        setSession(null);
      } else {
        setProfileCompletionLoading(Boolean(session));
        setSession(session);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setProfileCompletionLoading(Boolean(session));
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileCompletion() {
      if (!session?.access_token) {
        setProfileComplete(false);
        setProfileCompletionLoading(false);
        return;
      }

      setProfileCompletionLoading(true);

      let complete = false;

      try {
        const { user, profile } = await getMyProfile(session.access_token);
        complete = hasCompleteProfile(user, profile);
      } catch (err) {
        // A 401 here means the access token itself is invalid/expired, not that
        // the profile is incomplete — sign out so the user is routed back to
        // login instead of being shown the complete-profile onboarding flow.
        if (err instanceof ApiError && err.status === 401) {
          await supabase.auth.signOut();
        }
        complete = false;
      }

      if (!cancelled) {
        setProfileComplete(complete);
        setProfileCompletionLoading(false);
      }
    }

    loadProfileCompletion();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || !profileComplete) return;

    registerForPushNotifications(session.access_token).catch(error => {
      console.warn('[push] Failed to register push token:', error);
    });
  }, [profileComplete, session?.access_token]);

  const refreshProfileCompletion = async () => {
    if (!session?.access_token) {
      setProfileComplete(false);
      return false;
    }

    try {
      const { user, profile } = await getMyProfile(session.access_token);
      const complete = hasCompleteProfile(user, profile);
      setProfileComplete(complete);
      return complete;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await supabase.auth.signOut();
      }
      setProfileComplete(false);
      return false;
    }
  };

  const markProfileComplete = refreshProfileCompletion;

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        profileComplete,
        profileCompletionLoading,
        refreshProfileCompletion,
        markProfileComplete,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
