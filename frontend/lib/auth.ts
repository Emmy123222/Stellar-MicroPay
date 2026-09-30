/**
 * lib/auth.ts
 * Authentication helpers for API calls.
 *
 * JWT tokens are stored in sessionStorage (not localStorage) to reduce
 * XSS persistence risk. The backend also issues an httpOnly `jwt` cookie
 * during SEP-0010 verification; prefer cookie-backed auth where possible.
 */

const JWT_SESSION_KEY = "micropay_auth_token";
/** Legacy key — must never hold JWTs in localStorage. Cleared on access. */
const JWT_LOCAL_STORAGE_LEGACY_KEY = "micropay_auth_token";

function clearLegacyLocalStorageToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(JWT_LOCAL_STORAGE_LEGACY_KEY);
  } catch {
    // Ignore quota / privacy-mode errors
  }
}

/**
 * Returns the current JWT token from sessionStorage.
 */
export function getJwtToken(): string | null {
  if (typeof window === "undefined") return null;
  clearLegacyLocalStorageToken();
  try {
    return window.sessionStorage.getItem(JWT_SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Sets the JWT token in sessionStorage (cleared when the tab closes).
 */
export function setJwtToken(token: string): void {
  if (typeof window === "undefined") return;
  clearLegacyLocalStorageToken();
  window.sessionStorage.setItem(JWT_SESSION_KEY, token);
}

/**
 * Clears the JWT token from sessionStorage and any legacy localStorage copy.
 */
export function clearJwtToken(): void {
  if (typeof window === "undefined") return;
  clearLegacyLocalStorageToken();
  try {
    window.sessionStorage.removeItem(JWT_SESSION_KEY);
  } catch {
    // Ignore
  }
}
