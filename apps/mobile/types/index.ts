// Mirror of Prisma enums for use in the mobile app

export type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER';
export type RelationshipGoal = 'CASUAL' | 'SERIOUS' | 'FRIENDSHIP' | 'UNDECIDED';
export type SwipeAction = 'LIKE' | 'DISLIKE' | 'SUPER_LIKE';
export type MessageType = 'TEXT' | 'IMAGE' | 'GIF';
export type ReportStatus = 'PENDING' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';

export interface User {
  id: string;
  email: string;
  name: string;
  gender: Gender;
  birthday: string;
  bio?: string;
  city?: string;
  createdAt: string;
  updatedAt: string;
  profile?: Profile;
  photos: Photo[];
}

export interface Profile {
  id: string;
  userId: string;
  height?: number;
  education?: string;
  jobTitle?: string;
  company?: string;
  relationshipGoal?: RelationshipGoal;
  drinking?: string;
  smoking?: string;
  mbti?: string;
  constellation?: string;
  prompt1?: string;
  prompt2?: string;
}

export interface Photo {
  id: string;
  userId: string;
  url: string;
  orderIndex: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface Preference {
  id: string;
  userId: string;
  preferredGender?: Gender;
  minAge?: number;
  maxAge?: number;
  maxDistanceKm?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface Match {
  id: string;
  user1Id: string;
  user2Id: string;
  createdAt: string;
  unmatchedAt?: string;
  otherUser?: User;
  lastMessage?: Message;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  messageType: MessageType;
  isRead: boolean;
  createdAt: string;
}

export interface PrivacySettings {
  id: string;
  userId: string;
  showDistance: boolean;
  showAge: boolean;
  showOnlineStatus: boolean;
  discoverable: boolean;
  locationVisible: boolean;
}
