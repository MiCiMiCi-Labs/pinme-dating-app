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
        : data && typeof data === 'object' && 'error' in data
          ? String(data.error)
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

// ─── User & Profile ────────────────────────────────────────────────────────

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
  return parseResponse<{ message: string; user: Omit<AppUser, 'profile'>; profile: AppProfile }>(response);
}

// ─── Photos ────────────────────────────────────────────────────────────────

export type Photo = {
  id: string;
  url: string;
  isPrimary: boolean;
  orderIndex: number;
};

export async function getMyPhotos(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<Photo[]>(response);
}

export async function uploadPhoto(accessToken: string, uri: string, mimeType: string) {
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const formData = new FormData();
  formData.append('photo', { uri, name: `photo.${ext}`, type: mimeType } as unknown as Blob);

  const response = await fetch(`${API_BASE_URL}/api/v1/photos`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: formData,
  });
  return parseResponse<Photo>(response);
}

export async function setPrimaryPhoto(accessToken: string, photoId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/${photoId}/primary`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseResponse<Photo>(response);
}

export async function deletePhoto(accessToken: string, photoId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/${photoId}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (response.status === 204) return;
  return parseResponse<void>(response);
}

// ─── Discovery ─────────────────────────────────────────────────────────────

export type DiscoveryUser = {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  distanceKm: string | null;
  gender: string;
  profile: AppProfile | null;
  photos: Photo[];
};

export async function getDiscoveryFeed(accessToken: string, limit = 20) {
  const response = await fetch(`${API_BASE_URL}/api/v1/discovery?limit=${limit}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ users: DiscoveryUser[] }>(response);
}

// ─── Users ─────────────────────────────────────────────────────────────────

export type PublicUser = {
  id: string;
  name: string;
  age: number;
  gender: string;
  bio: string | null;
  city: string | null;
  profile: AppProfile | null;
  photos: Photo[];
};

export async function getUserById(accessToken: string, userId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ user: PublicUser }>(response);
}

// ─── Matches ───────────────────────────────────────────────────────────────

export type MatchUser = {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  profile: AppProfile | null;
  photos: Photo[];
};

export type Match = {
  matchId: string;
  createdAt: string;
  user: MatchUser;
};

export async function getMatches(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<Match[]>(response);
}

// ─── Swipes ────────────────────────────────────────────────────────────────

export type SwipeAction = 'LIKE' | 'DISLIKE' | 'SUPER_LIKE';

export async function createSwipe(accessToken: string, targetId: string, action: SwipeAction) {
  const response = await fetch(`${API_BASE_URL}/api/v1/swipes`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId, action }),
  });
  return parseResponse<{ swipe: unknown; match: { id: string } | null }>(response);
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ChatMessageType = 'TEXT' | 'IMAGE' | 'GIF' | 'SYSTEM';

export type ChatMessage = {
  id: string;
  matchId: string;
  senderId: string | null;
  content: string;
  messageType: ChatMessageType;
  isRead: boolean;
  createdAt: string;
  sender: {
    id: string;
    name: string;
  } | null;
};

export type ChatMatch = {
  matchId: string;
  createdAt: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  user: {
    id: string;
    name: string;
    age: number;
    gender: string;
    bio: string | null;
    city: string | null;
    profile: AppProfile | null;
    photos: Photo[];
  };
};

export async function getMatches(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<ChatMatch[]>(response);
}

export async function getMessages(accessToken: string, matchId: string, limit = 50) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}?limit=${limit}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ messages: ChatMessage[] }>(response);
}

export async function sendMessage(accessToken: string, matchId: string, content: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, messageType: 'TEXT' }),
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function markMessagesRead(accessToken: string, matchId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/read`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ updatedCount: number }>(response);
}
