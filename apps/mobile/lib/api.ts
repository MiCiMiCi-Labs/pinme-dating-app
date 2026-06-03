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

export async function getCurrentAppUser(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return parseResponse<{ user: unknown }>(response);
}
