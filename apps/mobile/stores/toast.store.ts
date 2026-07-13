import { atom } from 'nanostores';

export type ToastType = 'success' | 'error' | 'info';

export type ToastState = {
  visible: boolean;
  message: string;
  type: ToastType;
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const $toast = atom<ToastState>({
  visible: false,
  message: '',
  type: 'info',
});

export function showToast(message: string, type: ToastType = 'info', durationMs = 2400) {
  if (hideTimer) clearTimeout(hideTimer);

  $toast.set({ visible: true, message, type });

  hideTimer = setTimeout(() => {
    hideToast();
  }, durationMs);
}

export function hideToast() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  $toast.set({
    visible: false,
    message: '',
    type: 'info',
  });
}
