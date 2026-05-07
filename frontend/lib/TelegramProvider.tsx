"use client";
import { createContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

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
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  disableVerticalSwipes(): void;
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

// Pages where no back button should appear
const ROOT_PAGES = new Set(["/", "/auth", "/dashboard"]);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

  // Keep a stable router ref so touch handlers don't need router in their dep array
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  // History stack: track pages visited within this session so we know when
  // to show the back button and what to fall back to if history is empty.
  const historyStack = useRef<string[]>([]);
  useEffect(() => {
    const stack = historyStack.current;
    if (stack.length === 0 || stack[stack.length - 1] !== pathname) {
      stack.push(pathname);
    }
  }, [pathname]);

  // Show/hide Telegram's native back button and wire it to navigation.
  useEffect(() => {
    if (!webApp?.BackButton) return;

    if (ROOT_PAGES.has(pathname)) {
      webApp.BackButton.hide();
      return;
    }

    webApp.BackButton.show();

    const handleBack = () => {
      historyStack.current.pop();
      if (window.history.length > 1) {
        routerRef.current.back();
      } else {
        routerRef.current.push("/dashboard");
      }
    };

    webApp.BackButton.onClick(handleBack);
    return () => { webApp.BackButton.offClick(handleBack); };
  }, [pathname, webApp]);

  // Left-edge swipe gesture: prevent OS default, then navigate back on release.
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      swipeStartX.current = e.touches[0].clientX;
      swipeStartY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!e.cancelable) return;
      const dx = e.touches[0].clientX - swipeStartX.current;
      const dy = e.touches[0].clientY - swipeStartY.current;
      // Block the native iOS swipe-back so we can handle it ourselves
      if (swipeStartX.current < 30 && dx > 8 && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - swipeStartX.current;
      const dy = e.changedTouches[0].clientY - swipeStartY.current;
      const isEdgeSwipeBack =
        swipeStartX.current < 30 &&
        dx > 60 &&
        Math.abs(dx) > Math.abs(dy) * 1.5;

      if (isEdgeSwipeBack) {
        const currentPath = window.location.pathname;
        if (!ROOT_PAGES.has(currentPath)) {
          historyStack.current.pop();
          if (window.history.length > 1) {
            routerRef.current.back();
          } else {
            routerRef.current.push("/dashboard");
          }
        }
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
      .Telegram?.WebApp;

    // initData is non-empty only when running inside the Telegram client
    if (!tg?.initData) return;

    tg.ready();   // removes Telegram's loading state
    tg.expand();  // expand to full height

    // Prevent accidental Mini App close on swipe gestures
    tg.enableClosingConfirmation?.();
    tg.disableVerticalSwipes?.();

    setWebApp(tg);

    // Auto-authenticate: exchange Telegram identity for a themcq JWT,
    // then navigate to the welcome animation if user is on the landing or auth page.
    loginWithTelegram(tg.initData)
      .then(() => {
        const path = window.location.pathname;
        if (path === "/" || path === "/auth") {
          const firstName = tg.initDataUnsafe?.user?.first_name;
          const dest = firstName
            ? `/welcome?from=telegram&name=${encodeURIComponent(firstName)}`
            : "/welcome?from=telegram";
          window.location.href = dest;
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
