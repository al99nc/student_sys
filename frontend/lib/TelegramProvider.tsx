"use client";
import { createContext, useEffect, useState, ReactNode } from "react";

// ── Telegram WebApp type declarations ─────────────────────────────────────

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface TelegramMainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): TelegramMainButton;
  onClick(fn: () => void): TelegramMainButton;
  offClick(fn: () => void): TelegramMainButton;
  show(): TelegramMainButton;
  hide(): TelegramMainButton;
  enable(): TelegramMainButton;
  disable(): TelegramMainButton;
  showProgress(leaveActive?: boolean): TelegramMainButton;
  hideProgress(): TelegramMainButton;
  setParams(params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }): TelegramMainButton;
}

export interface TelegramBackButton {
  isVisible: boolean;
  onClick(fn: () => void): TelegramBackButton;
  offClick(fn: () => void): TelegramBackButton;
  show(): TelegramBackButton;
  hide(): TelegramBackButton;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
    [key: string]: unknown;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
  ready(): void;
  expand(): void;
  close(): void;
  sendData(data: string): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

// ── Context ────────────────────────────────────────────────────────────────

export interface TelegramContextValue {
  webApp: TelegramWebApp | null;
  user: TelegramUser | null;
  mainButton: TelegramMainButton | null;
  backButton: TelegramBackButton | null;
  isInTelegram: boolean;
  startParam: string | null;
}

export const TelegramContext = createContext<TelegramContextValue>({
  webApp: null,
  user: null,
  mainButton: null,
  backButton: null,
  isInTelegram: false,
  startParam: null,
});

// ── Provider ───────────────────────────────────────────────────────────────

async function loginWithTelegram(initData: string): Promise<void> {
  const apiUrl = "/api";
  const res = await fetch(`${apiUrl}/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init_data: initData }),
  });
  if (!res.ok) {
    throw new Error(`Telegram auth failed: ${res.status}`);
  }
  const data = await res.json();
  localStorage.setItem("token", data.access_token);
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
      .Telegram?.WebApp;

    // initData is non-empty only when running inside the Telegram client
    if (!tg?.initData) return;

    tg.ready();   // removes Telegram's loading state
    tg.expand();  // expand to full height
    setWebApp(tg);

    // Auto-authenticate: exchange Telegram identity for a cortexQ JWT,
    // then navigate to dashboard if user is on the landing or auth page.
    loginWithTelegram(tg.initData)
      .then(() => {
        const path = window.location.pathname;
        if (path === "/" || path === "/auth") {
          window.location.href = "/dashboard";
        }
      })
      .catch((err) =>
        console.error("[TelegramProvider] auth error:", err)
      );
  }, []);

  return (
    <TelegramContext.Provider
      value={{
        webApp,
        user: webApp?.initDataUnsafe?.user ?? null,
        mainButton: webApp?.MainButton ?? null,
        backButton: webApp?.BackButton ?? null,
        isInTelegram: !!webApp?.initData,
        startParam: webApp?.initDataUnsafe?.start_param ?? null,
      }}
    >
      {children}
    </TelegramContext.Provider>
  );
}
