const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const API_BASE_URL = apiUrl.replace(/\/$/, '');

type SyncUserInput = {
  name?: string;
  gender?: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER';
  birthday?: string;
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

export async function syncAuthUser(accessToken: string, body?: SyncUserInput) {
  const response = await fetch(`${API_BASE_URL}/api/auth/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });

  return parseResponse<{ message: string; user: unknown }>(response);
}

// ─── User & Profile ────────────────────────────────────────────────────────

export type AppProfile = {
  id: string;
  height: number | null;
  education: string | null;
  jobTitle: string | null;
  company: string | null;
  relationshipGoal: string | null;
  drinking: string | null;
  smoking: string | null;
  mbti: string | null;
  constellation: string | null;
  prompt1: string | null;
  prompt2: string | null;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  gender: string;
  birthday: string;
  profile: AppProfile | null;
};

export async function getCurrentAppUser(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseResponse<{ user: AppUser }>(response);
}

export type ProfileUpdateInput = {
  height?: number | null;
  education?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  relationshipGoal?: string | null;
  drinking?: string | null;
  smoking?: string | null;
  mbti?: string | null;
  constellation?: string | null;
  prompt1?: string | null;
  prompt2?: string | null;
};

export async function updateMyProfileData(accessToken: string, data: ProfileUpdateInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/profiles/me`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return parseResponse<{ message: string; profile: AppProfile }>(response);
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
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseResponse<Photo[]>(response);
}

export async function uploadPhoto(accessToken: string, uri: string, mimeType: string) {
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const formData = new FormData();
  formData.append('photo', { uri, name: `photo.${ext}`, type: mimeType } as unknown as Blob);

  const response = await fetch(`${API_BASE_URL}/api/v1/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  return parseResponse<Photo>(response);
}

export async function setPrimaryPhoto(accessToken: string, photoId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/${photoId}/primary`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseResponse<Photo>(response);
}

export async function deletePhoto(accessToken: string, photoId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/${photoId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 204) return;
  return parseResponse<void>(response);
}
