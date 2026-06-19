import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  getMyPhotos,
  getMyProfile,
  syncAuthUser,
  type AppProfile,
  type AppUser,
} from '@/lib/api';

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
  profile: AppProfile | null,
  photoCount: number
) {
  return Boolean(
    user.name?.trim() &&
      user.birthday &&
      user.gender &&
      user.city?.trim() &&
      user.bio?.trim() &&
      profile?.relationshipGoal &&
      photoCount >= 2
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
        try {
          await syncAuthUser(session.access_token, { createIfMissing: false });
        } catch {
          // Existing users can still evaluate completeness from current profile data.
        }

        const [{ user, profile }, photos] = await Promise.all([
          getMyProfile(session.access_token),
          getMyPhotos(session.access_token).catch(() => []),
        ]);
        complete = hasCompleteProfile(user, profile, photos.length);
      } catch {
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

  const refreshProfileCompletion = async () => {
    if (!session?.access_token) {
      setProfileComplete(false);
      return false;
    }

    try {
      try {
        await syncAuthUser(session.access_token, { createIfMissing: false });
      } catch {
        // Keep refresh working even if sync endpoint fails for older records.
      }

      const [{ user, profile }, photos] = await Promise.all([
        getMyProfile(session.access_token),
        getMyPhotos(session.access_token).catch(() => []),
      ]);
      const complete = hasCompleteProfile(user, profile, photos.length);
      setProfileComplete(complete);
      return complete;
    } catch {
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
