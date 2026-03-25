export function saveToken(token: string) {
  localStorage.setItem("token", token);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function removeToken() {
  localStorage.removeItem("token");
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

/** Returns true only if token exists AND is not expired */
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  const exp = getTokenExpiry(token);
  if (exp === null) return true; // no exp claim — trust it
  return Date.now() / 1000 < exp;
}

/** Call on logout or when a 401 is detected */
export function logout() {
  removeToken();
  window.location.href = "/auth";
}
