import { create } from 'zustand';

interface ToastState {
  message: string | null;
  kind: 'ok' | 'error';
  show: (message: string, kind?: 'ok' | 'error') => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'ok',
  show: (message, kind = 'ok') => {
    clearTimeout(timer);
    set({ message, kind });
    timer = setTimeout(() => set({ message: null }), 3500);
  },
  hide: () => set({ message: null }),
}));
