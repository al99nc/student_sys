export function saveToken(token: string) {
  try {
    localStorage.setItem("token", token);
    // Verify write succeeded
    if (localStorage.getItem("token") !== token) {
      console.warn("Token save verification failed - localStorage may be full or disabled");
    }
  } catch (e) {
    console.error("Failed to save token:", e);
    // Fallback to sessionStorage as backup
    try {
      sessionStorage.setItem("token", token);
    } catch (e2) {
      console.error("Failed to save token to sessionStorage:", e2);
    }
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
  } catch {
    return sessionStorage.getItem("token") || null;
  }
}

export function removeToken() {
  try {
    localStorage.removeItem("token");
  } catch {}
  try {
    sessionStorage.removeItem("token");
  } catch {}
}

/** Decode JWT payload without a library */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ?? null; // seconds since epoch
  } catch {
    return null;
  }
}

/** Get remaining time on token in seconds */
export function getTokenTimeRemaining(): number | null {
  const token = getToken();
  if (!token) return null;
  const exp = getTokenExpiry(token);
  if (exp === null) return null;
  const remaining = exp - Math.floor(Date.now() / 1000);
  return remaining > 0 ? remaining : 0;
}

/** Returns true only if token exists AND is not expired */
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  const exp = getTokenExpiry(token);
  if (exp === null) return false; // no exp claim — reject for safety
  const remaining = exp - Math.floor(Date.now() / 1000);
  return remaining > 0;
}

/** Call on logout or when a 401 is detected */
export function logout() {
  removeToken();
  if (typeof window !== "undefined") {
    window.location.href = "/auth";
  }
}
