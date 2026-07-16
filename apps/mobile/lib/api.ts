const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const API_BASE_URL = apiUrl.replace(/\/$/, '');

type SyncUserInput = {
  name?: string;
  gender?: Gender;
  birthday?: string;
  createIfMissing?: boolean;
};

export type Gender =
  | 'MALE'
  | 'FEMALE'
  | 'NON_BINARY'
  | 'SELF_DESCRIBE'
  | 'PREFER_NOT_TO_SAY'
  | 'OTHER';
export type RelationshipGoal =
  | 'LONG_TERM'
  | 'SERIOUS_OPEN_TO_SHORT_TERM'
  | 'CASUAL'
  | 'SERIOUS'
  | 'FRIENDSHIP'
  | 'UNDECIDED';

export type AppProfile = {
  id: string;
  userId: string;
  height: number | null;
  pronouns: string | null;
  sexualOrientation: string | null;
  sexualOrientationVisible: boolean;
  education: string | null;
  educationLevel: string | null;
  jobTitle: string | null;
  company: string | null;
  companyVisible: boolean;
  languages: string[];
  hometown: string | null;
  relationshipGoal: RelationshipGoal | null;
  drinking: string | null;
  smoking: string | null;
  exercise: string | null;
  dietary: string | null;
  drugs: string | null;
  pets: string | null;
  sleepHabit: string | null;
  socialHabit: string | null;
  children: string | null;
  wantsChildren: string | null;
  relationshipStyle: string | null;
  communicationStyle: string | null;
  idealFirstDate: string | null;
  interests: string[];
  weekend: string | null;
  favorites: string | null;
  mbti: string | null;
  constellation: string | null;
  prompt1Question: string | null;
  prompt1: string | null;
  prompt2Question: string | null;
  prompt2: string | null;
  prompt3Question: string | null;
  prompt3: string | null;
  hiddenFields: string[];
};

export type AppUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  gender: string;
  birthday: string;
  city: string | null;
  bio: string | null;
  profile: AppProfile | null;
};

export type ProfileUpdateInput = {
  name?: string;
  gender?: Gender;
  birthday?: string;
  city?: string | null;
  bio?: string | null;
  height?: number | null;
  pronouns?: string | null;
  sexualOrientation?: string | null;
  sexualOrientationVisible?: boolean;
  education?: string | null;
  educationLevel?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  companyVisible?: boolean;
  languages?: string[];
  hometown?: string | null;
  relationshipGoal?: RelationshipGoal | null;
  drinking?: string | null;
  smoking?: string | null;
  exercise?: string | null;
  dietary?: string | null;
  drugs?: string | null;
  pets?: string | null;
  sleepHabit?: string | null;
  socialHabit?: string | null;
  children?: string | null;
  wantsChildren?: string | null;
  relationshipStyle?: string | null;
  communicationStyle?: string | null;
  idealFirstDate?: string | null;
  interests?: string[];
  weekend?: string | null;
  favorites?: string | null;
  mbti?: string | null;
  constellation?: string | null;
  prompt1Question?: string | null;
  prompt1?: string | null;
  prompt2Question?: string | null;
  prompt2?: string | null;
  prompt3Question?: string | null;
  prompt3?: string | null;
  hiddenFields?: string[];
};

export type Preference = {
  id: string;
  userId: string;
  preferredGender: Gender | null;
  minAge: number | null;
  maxAge: number | null;
  maxDistanceKm: number | null;
  minHeight: number | null;
  maxHeight: number | null;
};

export type Preferences = Preference;

export type PreferenceUpdateInput = {
  preferredGender?: Gender | null;
  minAge?: number | null;
  maxAge?: number | null;
  maxDistanceKm?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
};

export type LocationUpdateInput = {
  latitude: number;
  longitude: number;
  city?: string | null;
};

export type PrivacySettings = {
  id?: string;
  userId?: string;
  discoverable: boolean;
  showDistance: boolean;
  showOnlineStatus: boolean;
  locationVisible?: boolean;
};

export type PrivacySettingsUpdateInput = {
  discoverable?: boolean;
  showDistance?: boolean;
  showOnlineStatus?: boolean;
};

export type BlockedUser = {
  id: string;
  name: string;
  city: string | null;
  photos: Photo[];
};

export type Block = {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: string;
  blocked?: BlockedUser;
};

export type ReportInput = {
  reportedId: string;
  reason: string;
  description?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isMatchLimitError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === 'MATCH_LIMIT_REACHED' || error.code === 'TARGET_MATCH_LIMIT_REACHED')
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String(data.message)
        : data && typeof data === 'object' && 'error' in data
          ? String(data.error)
        : 'Request failed';
    const code =
      data && typeof data === 'object' && 'code' in data
        ? String(data.code)
        : data && typeof data === 'object' && 'errorCode' in data
          ? String(data.errorCode)
          : undefined;
    throw new ApiError(message, response.status, code);
  }

  return data as T;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 12_000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

export async function registerPushToken(
  accessToken: string,
  body: { token: string; platform?: string }
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/notifications/register-token`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseResponse<{ token: unknown }>(response);
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

export async function updateMyPreferences(accessToken: string, data: PreferenceUpdateInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/preferences/me`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return parseResponse<{ message: string; preferences: Preference }>(response);
}

export async function getMyPreferences(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/preferences/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ preferences: Preference | null }>(response);
}

export async function updateMyLocation(accessToken: string, data: LocationUpdateInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/location/me`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return parseResponse<{
    id: string;
    userId: string;
    latitude: number;
    longitude: number;
    city: string | null;
    updatedAt: string;
  }>(response);
}

export async function updateLocation(
  accessToken: string,
  latitude: number,
  longitude: number,
  city?: string | null
) {
  return updateMyLocation(accessToken, { latitude, longitude, city });
}

export async function getPrivacySettings(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/privacy/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<PrivacySettings>(response);
}

export async function updatePrivacySettings(accessToken: string, data: PrivacySettingsUpdateInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/privacy/me`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return parseResponse<PrivacySettings>(response);
}

// ─── Safety ────────────────────────────────────────────────────────────────

export async function getBlockedUsers(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/blocks`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ blocks: Block[] }>(response);
}

export async function blockUser(accessToken: string, blockedId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/blocks`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ blockedId }),
  });
  return parseResponse<Block>(response);
}

export async function unblockUser(accessToken: string, blockedUserId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/blocks/${blockedUserId}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (response.status === 204) return;
  return parseResponse<void>(response);
}

export async function reportUser(accessToken: string, data: ReportInput) {
  const response = await fetch(`${API_BASE_URL}/api/v1/reports`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return parseResponse<{ id: string; reporterId: string; reportedId: string; reason: string }>(response);
}

// ─── Voice Rooms ───────────────────────────────────────────────────────────

export type VoiceRoomParticipant = {
  id: string;
  userId: string;
  isMutedByHost: boolean;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    photos: Photo[];
  };
};

export type VoiceRoom = {
  id: string;
  ownerId: string;
  name: string;
  tags: string[];
  livekitRoomName: string;
  isOpen: boolean;
  createdAt: string;
  closedAt: string | null;
  participantCount: number;
  owner: {
    id: string;
    name: string;
    photos: Photo[];
  };
  participants: VoiceRoomParticipant[];
};

export type VoiceRoomsResponse = {
  rooms: VoiceRoom[];
  nextCursor: string | null;
  hasMore: boolean;
};

export async function getVoiceRoomTags(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/tags`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ tags: string[] }>(response);
}

export async function getVoiceRooms(
  accessToken: string,
  searchOrOptions: string | {
    search?: string;
    tag?: string | null;
    limit?: number;
    cursor?: string | null;
  } = ''
) {
  const options = typeof searchOrOptions === 'string'
    ? { search: searchOrOptions }
    : searchOrOptions;
  const params = new URLSearchParams({ limit: String(options.limit ?? 20) });
  const search = options.search?.trim();
  if (search) params.set('query', search);
  if (options.tag) params.set('tag', options.tag);
  if (options.cursor) params.set('cursor', options.cursor);

  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<VoiceRoomsResponse>(response);
}

export async function createVoiceRoom(accessToken: string, data: { name: string; tags: string[] }) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseResponse<{ room: VoiceRoom }>(response);
}

export async function getVoiceRoom(accessToken: string, roomId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/${roomId}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ room: VoiceRoom }>(response);
}

export async function joinVoiceRoom(accessToken: string, roomId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/${roomId}/join`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<{
    room: VoiceRoom;
    url: string;
    token: string;
    participant: { id: string; userId: string; isMutedByHost: boolean };
  }>(response);
}

export async function leaveVoiceRoom(accessToken: string, roomId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/${roomId}/leave`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (response.status === 204) return;
  return parseResponse<void>(response);
}

export async function closeVoiceRoom(accessToken: string, roomId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/${roomId}/close`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ room: VoiceRoom }>(response);
}

export async function muteVoiceRoomParticipant(
  accessToken: string,
  roomId: string,
  userId: string,
  muted: boolean
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/voice-rooms/${roomId}/mute`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, muted }),
  });
  return parseResponse<{ room: VoiceRoom }>(response);
}

// ─── Photos ────────────────────────────────────────────────────────────────

export type Photo = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  orderIndex: number;
};

export async function getMyPhotos(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/photos/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<Photo[]>(response);
}

export async function uploadPhoto(
  accessToken: string,
  uri: string,
  mimeType: string,
  thumbnail?: { uri: string; mimeType: string }
) {
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const formData = new FormData();
  formData.append('photo', { uri, name: `photo.${ext}`, type: mimeType } as unknown as Blob);

  if (thumbnail) {
    const thumbnailExt = thumbnail.mimeType.split('/')[1] ?? 'jpg';
    formData.append(
      'thumbnail',
      {
        uri: thumbnail.uri,
        name: `thumbnail.${thumbnailExt}`,
        type: thumbnail.mimeType,
      } as unknown as Blob
    );
  }

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
  city: string | null;
  distanceKm: string | null;
  gender: string;
  jobTitle: string | null;
  relationshipGoal: RelationshipGoal | null;
  height: number | null;
  primaryPhoto: Photo | null;
  photos: Photo[];
  photoCount: number;
};

export type DiscoveryFeedResponse = {
  users: DiscoveryUser[];
  nextCursor: string | null;
};

export async function getDiscoveryFeed(accessToken: string, limit = 10, cursor?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`${API_BASE_URL}/api/v1/discovery?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<DiscoveryFeedResponse>(response);
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

export async function getMatchProfile(accessToken: string, matchId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches/${matchId}/profile`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ user: PublicUser }>(response);
}

// ─── Matches ───────────────────────────────────────────────────────────────

// ─── Swipes ────────────────────────────────────────────────────────────────

export type SwipeAction = 'LIKE' | 'DISLIKE' | 'SUPER_LIKE';

export async function createSwipe(accessToken: string, targetId: string, action: SwipeAction) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/swipes`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId, action }),
  });
  return parseResponse<{
    swipe: unknown;
    match: { id: string; createdAt?: string } | null;
    message?: ChatMessage | null;
  }>(response);
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type ChatMessageType = 'TEXT' | 'IMAGE' | 'GIF' | 'SYSTEM' | 'VOICE' | 'VIDEO';

export type Reaction = {
  id: string;
  userId: string;
  emoji: string;
};

export type ReplyPreview = {
  id: string;
  content: string;
  messageType: ChatMessageType;
  recalledAt: string | null;
  sender: { id: string; name: string } | null;
};

export type ChatMessage = {
  id: string;
  matchId: string;
  senderId: string | null;
  content: string;
  messageType: ChatMessageType;
  durationSec: number | null;
  isRead: boolean;
  recalledAt: string | null;
  reactions: Reaction[];
  createdAt: string;
  sender: {
    id: string;
    name: string;
  } | null;
  replyTo: ReplyPreview | null;
};

export type ChatIntimacy = {
  level: 0 | 1 | 2 | 3 | 4;
  label: 'New' | 'Warming up' | 'Steady' | 'Close' | 'Deep';
  color: 'white' | 'yellow' | 'pink' | 'red' | 'purple';
  score: number;
  mutualDays: number;
  currentStreakDays: number;
};

export type ChatMatch = {
  matchId: string;
  createdAt: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  intimacy: ChatIntimacy;
  user: {
    id: string;
    name: string;
    age: number;
    gender: string;
    bio: string | null;
    city: string | null;
    photos: Photo[];
  };
};

export type MatchSummary = {
  matchId: string;
  createdAt: string;
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

export type LikesPreview = {
  count: number;
  preview: Array<{
    userId: string;
    photoUrl: string;
    thumbnailUrl: string;
  }>;
};

export type Subscription = {
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELED';
  plan: string | null;
  source: string | null;
  promoCode: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

export async function getLikesPreview(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/likes/me/preview`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<LikesPreview>(response);
}

export async function getLikesList(accessToken: string) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/likes/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ likedBy: PublicUser[] }>(response);
}

export async function getMySubscription(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/subscription/me`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ subscription: Subscription }>(response);
}

export async function redeemPromoCode(accessToken: string, code: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/subscription/redeem-code`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  return parseResponse<{ message: string; subscription: Subscription }>(response);
}

// --- Private 1:1 voice calling (docs/private-voice-calling-spec.md) ---------

export type CallPreferenceState = {
  mineEnabled: boolean;
  theirsEnabled: boolean;
  mutuallyEnabled: boolean;
};

export type CallParticipant = {
  id: string;
  name: string;
  photoUrl: string | null;
};

export type CallType = 'AUDIO' | 'VIDEO';
export type CallStatus = 'RINGING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'MISSED' | 'ENDED' | 'FAILED';

export type CallSummary = {
  id: string;
  matchId: string;
  type: CallType;
  status: CallStatus;
  roomName: string;
  expiresAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  failureReason: string | null;
  createdAt: string;
  caller: CallParticipant;
  callee: CallParticipant;
};

export type LiveKitCredentials = {
  url: string;
  token: string;
  roomName: string;
};

export async function getCallPreference(accessToken: string, matchId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches/${matchId}/call-preference`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallPreferenceState>(response);
}

export async function updateCallPreference(accessToken: string, matchId: string, audioEnabled: boolean) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches/${matchId}/call-preference`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audioEnabled }),
  });
  return parseResponse<CallPreferenceState>(response);
}

export async function createCallInvitation(accessToken: string, matchId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches/${matchId}/call-invitation`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallPreferenceState & { message: ChatMessage }>(response);
}

export async function startCall(accessToken: string, matchId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${matchId}/start`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'AUDIO' }),
  });
  return parseResponse<CallSummary>(response);
}

export async function getIncomingCalls(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/incoming`, {
    headers: authHeaders(accessToken),
  });
  const data = await parseResponse<{ calls: CallSummary[] }>(response);
  return data.calls ?? [];
}

// Recovery: finds any RINGING or ACCEPTED call the current user (caller or
// callee) is a participant in — unlike getIncomingCalls, which only ever
// surfaces the callee side of a RINGING call. Identity comes entirely from
// the bearer token; there is no userId parameter to pass or spoof.
export async function getActiveCall(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/active`, {
    headers: authHeaders(accessToken),
  });
  const data = await parseResponse<{ call: CallSummary | null }>(response);
  return data.call ?? null;
}

export async function getCall(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallSummary>(response);
}

export async function getCallLiveKitCredentials(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/livekit-token`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<LiveKitCredentials>(response);
}

export async function acceptCall(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/accept`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallSummary>(response);
}

export async function declineCall(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/decline`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallSummary>(response);
}

export async function cancelCall(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/cancel`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallSummary>(response);
}

export async function endCall(accessToken: string, callId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/end`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseResponse<CallSummary>(response);
}

export type CallFailureReason = 'MICROPHONE_DENIED' | 'LIVEKIT_CONNECTION_FAILED' | 'NETWORK_ERROR';

export async function failCall(accessToken: string, callId: string, failureReason: CallFailureReason) {
  const response = await fetch(`${API_BASE_URL}/api/v1/calls/${callId}/fail`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ failureReason }),
  });
  return parseResponse<CallSummary>(response);
}

export async function getMatches(accessToken: string, limit = 20) {
  const response = await fetch(`${API_BASE_URL}/api/v1/matches?limit=${limit}`, {
    headers: authHeaders(accessToken),
  });
  const data = await parseResponse<MatchSummary[] | { matches?: MatchSummary[] }>(response);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.matches)) return data.matches;
  return [];
}

export async function getChatMatches(accessToken: string, limit = 20) {
  const response = await fetch(`${API_BASE_URL}/api/v1/chats?limit=${limit}`, {
    headers: authHeaders(accessToken),
  });
  const data = await parseResponse<ChatMatch[] | { chats?: ChatMatch[]; matches?: ChatMatch[] }>(response);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.chats)) return data.chats;
  if (data && Array.isArray(data.matches)) return data.matches;
  return [];
}

export type ChatMessagesResponse = {
  messages: ChatMessage[];
  intimacy: ChatIntimacy;
  nextCursor: string | null;
  hasMore: boolean;
};

export async function getMessages(
  accessToken: string,
  matchId: string,
  options: { limit?: number; before?: string | null } = {}
) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.before) params.set('before', options.before);

  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });
  return parseResponse<ChatMessagesResponse>(response);
}

export async function getReplySuggestions(
  accessToken: string,
  matchId: string,
  tone: 'warm' | 'playful' | 'curious' = 'warm'
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/reply-suggestions`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId, tone }),
  });
  return parseResponse<{ suggestions: string[] }>(response);
}

export async function sendMessage(
  accessToken: string,
  matchId: string,
  content: string,
  replyToId?: string
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, messageType: 'TEXT', ...(replyToId ? { replyToId } : {}) }),
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function sendGifMessage(
  accessToken: string,
  matchId: string,
  gifUrl: string,
  replyToId?: string
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: gifUrl, messageType: 'GIF', ...(replyToId ? { replyToId } : {}) }),
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function sendVoiceMessage(
  accessToken: string,
  matchId: string,
  audioUri: string,
  durationSec: number,
  replyToId?: string
) {
  const formData = new FormData();
  formData.append('audio', { uri: audioUri, name: 'voice.m4a', type: 'audio/m4a' } as unknown as Blob);
  formData.append('durationSec', String(Math.round(durationSec)));
  if (replyToId) formData.append('replyToId', replyToId);

  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/voice`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: formData,
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function sendImageMessage(
  accessToken: string,
  matchId: string,
  imageUri: string,
  mimeType: string,
  replyToId?: string
) {
  const rawExt = mimeType.split('/')[1] ?? 'jpg';
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const formData = new FormData();
  formData.append('image', { uri: imageUri, name: `image.${ext}`, type: mimeType } as unknown as Blob);
  if (replyToId) formData.append('replyToId', replyToId);

  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/image`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: formData,
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function sendVideoMessage(
  accessToken: string,
  matchId: string,
  videoUri: string,
  mimeType: string,
  durationSec?: number,
  replyToId?: string
) {
  const formData = new FormData();
  formData.append('video', { uri: videoUri, name: 'video.mp4', type: mimeType } as unknown as Blob);
  if (durationSec != null) formData.append('durationSec', String(Math.round(durationSec)));
  if (replyToId) formData.append('replyToId', replyToId);

  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/video`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: formData,
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function recallMessage(accessToken: string, matchId: string, messageId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/${messageId}/recall`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseResponse<{ message: ChatMessage }>(response);
}

export async function toggleReaction(
  accessToken: string,
  matchId: string,
  messageId: string,
  emoji: string
) {
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/${matchId}/${messageId}/reaction`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
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
