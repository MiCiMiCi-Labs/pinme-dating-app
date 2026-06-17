// Mirror of Prisma enums for use in the mobile app

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
  pronouns?: string;
  sexualOrientation?: string;
  sexualOrientationVisible?: boolean;
  education?: string;
  educationLevel?: string;
  jobTitle?: string;
  company?: string;
  companyVisible?: boolean;
  languages?: string[];
  hometown?: string;
  relationshipGoal?: RelationshipGoal;
  drinking?: string;
  smoking?: string;
  exercise?: string;
  dietary?: string;
  drugs?: string;
  pets?: string;
  sleepHabit?: string;
  socialHabit?: string;
  children?: string;
  wantsChildren?: string;
  relationshipStyle?: string;
  communicationStyle?: string;
  idealFirstDate?: string;
  interests?: string[];
  weekend?: string;
  favorites?: string;
  mbti?: string;
  constellation?: string;
  prompt1Question?: string;
  prompt1?: string;
  prompt2Question?: string;
  prompt2?: string;
  prompt3Question?: string;
  prompt3?: string;
  hiddenFields?: string[];
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
