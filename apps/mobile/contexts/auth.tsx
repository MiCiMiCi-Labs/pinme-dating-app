import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getProfileCompletion, setProfileCompletion } from '@/lib/profileCompletion';

type AuthContextType = {
  session: Session | null;
  loading: boolean;
  profileComplete: boolean;
  profileCompletionLoading: boolean;
  markProfileComplete: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  profileComplete: false,
  profileCompletionLoading: true,
  markProfileComplete: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileCompletionLoading, setProfileCompletionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileCompletion() {
      if (!session?.user.id) {
        setProfileComplete(false);
        setProfileCompletionLoading(false);
        return;
      }

      setProfileCompletionLoading(true);
      const complete = await getProfileCompletion(session.user.id);

      if (!cancelled) {
        setProfileComplete(complete);
        setProfileCompletionLoading(false);
      }
    }

    loadProfileCompletion();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const markProfileComplete = async () => {
    if (!session?.user.id) return;

    await setProfileCompletion(session.user.id, true);
    setProfileComplete(true);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        profileComplete,
        profileCompletionLoading,
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
