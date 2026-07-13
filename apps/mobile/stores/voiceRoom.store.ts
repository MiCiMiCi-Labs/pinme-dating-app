import { map } from 'nanostores';

export type VoiceRoomState = {
  activeVoiceRoomId: string | null;
  micEnabled: boolean;
  speakerEnabled: boolean;
  mutedUserIds: string[];
  joinedParticipant:
    | {
        userId: string;
        name: string;
        roomId: string;
      }
    | null;
  voiceRoomNeedsRefresh: boolean;
};

export const $voiceRoom = map<VoiceRoomState>({
  activeVoiceRoomId: null,
  micEnabled: false,
  speakerEnabled: true,
  mutedUserIds: [],
  joinedParticipant: null,
  voiceRoomNeedsRefresh: false,
});

export function setActiveVoiceRoom(roomId: string | null) {
  $voiceRoom.setKey('activeVoiceRoomId', roomId);
}

export function setMicEnabled(micEnabled: boolean) {
  $voiceRoom.setKey('micEnabled', micEnabled);
}

export function setSpeakerEnabled(speakerEnabled: boolean) {
  $voiceRoom.setKey('speakerEnabled', speakerEnabled);
}

export function setVoiceRoomMutedUsers(mutedUserIds: string[]) {
  $voiceRoom.setKey('mutedUserIds', mutedUserIds);
}

export function registerVoiceRoomJoin(joinedParticipant: NonNullable<VoiceRoomState['joinedParticipant']>) {
  $voiceRoom.setKey('joinedParticipant', joinedParticipant);
  $voiceRoom.setKey('voiceRoomNeedsRefresh', true);
}

export function markVoiceRoomNeedsRefresh() {
  $voiceRoom.setKey('voiceRoomNeedsRefresh', true);
}

export function markVoiceRoomRefreshHandled() {
  $voiceRoom.setKey('voiceRoomNeedsRefresh', false);
}

export function resetVoiceRoomState() {
  $voiceRoom.set({
    activeVoiceRoomId: null,
    micEnabled: false,
    speakerEnabled: true,
    mutedUserIds: [],
    joinedParticipant: null,
    voiceRoomNeedsRefresh: false,
  });
}
