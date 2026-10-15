"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type AuthUser = {
  id: string;
  login: string;
  email: string;
  timezone: string;
};

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  status: "boot" | "guest" | "authed";
  setAuth: (token: string, user: AuthUser) => void;
  setBooted: () => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      status: "boot",
      setAuth: (token, user) => set({ accessToken: token, user, status: "authed" }),
      setBooted: () => set((s) => ({ status: s.status === "boot" ? "guest" : s.status })),
      clear: () => set({ accessToken: null, user: null, status: "guest" }),
    }),
    {
      name: "ms-auth",
      storage: createJSONStorage(() => localStorage),
      // Сохраняем только эти поля, чтобы не тащить "boot" с собой
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        status: state.status === "authed" ? "authed" : "guest",
      }),
    },
  ),
);

export type Toast = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
};

type ToastState = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let toastSeq = 1;
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, body?: string) => useToastStore.getState().push({ kind: "success", title, body }),
  error: (title: string, body?: string) => useToastStore.getState().push({ kind: "error", title, body }),
  info: (title: string, body?: string) => useToastStore.getState().push({ kind: "info", title, body }),
};

type OnlineState = {
  online: boolean;
  setOnline: (v: boolean) => void;
};

export const useOnlineStore = create<OnlineState>((set) => ({
  online: false,
  setOnline: (v) => set({ online: v }),
}));

type WipeState = {
  wipe: { x: number; y: number; key: number } | null;
  triggerWipe: (x: number, y: number) => void;
  clearWipe: () => void;
};

let wipeSeq = 1;
export const useUiStore = create<WipeState>((set) => ({
  wipe: null,
  triggerWipe: (x, y) => {
    set({ wipe: { x, y, key: wipeSeq++ } });
    setTimeout(() => set({ wipe: null }), 420);
  },
  clearWipe: () => set({ wipe: null }),
}));