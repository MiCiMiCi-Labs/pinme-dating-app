const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const API_BASE_URL = apiUrl.replace(/\/$/, '');

type SyncUserInput = {
  name?: string;
  gender?: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER';
  birthday?: string;
};

export type RelationshipGoal = 'CASUAL' | 'SERIOUS' | 'FRIENDSHIP' | 'UNDECIDED';

export type AppProfile = {
  id: string;
  userId: string;
  height: number | null;
  education: string | null;
  jobTitle: string | null;
  company: string | null;
  relationshipGoal: RelationshipGoal | null;
  drinking: string | null;
  smoking: string | null;
  mbti: string | null;
  constellation: string | null;
  prompt1: string | null;
  prompt2: string | null;
};

export type AppUser = {
  id: string;
  email: string;
  name: string;
  gender: string;
  birthday: string;
  city: string | null;
  bio: string | null;
  profile: AppProfile | null;
};

export type ProfileUpdateInput = {
  city?: string | null;
  bio?: string | null;
  height?: number | null;
  education?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  relationshipGoal?: RelationshipGoal | null;
  drinking?: string | null;
  smoking?: string | null;
  mbti?: string | null;
  constellation?: string | null;
  prompt1?: string | null;
  prompt2?: string | null;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String(data.message)
        : 'Request failed';
    throw new Error(message);
  }

  return data as T;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function syncAuthUser(accessToken: string, body?: SyncUserInput) {
  const response = await fetch(`${API_BASE_URL}/api/auth/sync`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  return parseResponse<{ message: string; user: unknown }>(response);
}

export async function getCurrentAppUser(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: authHeaders(accessToken),
  });

  return parseResponse<{ user: AppUser }>(response);
}

export async function getMyProfile(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/profiles/me`, {
    headers: authHeaders(accessToken),
  });

  return parseResponse<{ user: Omit<AppUser, 'profile'>; profile: AppProfile | null }>(response);
}

export async function updateMyProfileData(accessToken: string, data: ProfileUpdateInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/profiles/me`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return parseResponse<{ message: string; user: Omit<AppUser, 'profile'>; profile: AppProfile }>(
    response
  );
}
