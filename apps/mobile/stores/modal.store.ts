import { atom } from 'nanostores';

export type GlobalModalName =
  | 'match-success'
  | 'profile-incomplete'
  | 'voice-room-joined'
  | 'ai-reply'
  | 'network-error';

export type GlobalModalState<TPayload = unknown> = {
  name: GlobalModalName | null;
  payload?: TPayload;
};

export const $globalModal = atom<GlobalModalState>({
  name: null,
});

export function openGlobalModal<TPayload>(name: GlobalModalName, payload?: TPayload) {
  $globalModal.set({ name, payload });
}

export function closeGlobalModal() {
  $globalModal.set({ name: null });
}
