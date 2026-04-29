/**
 * lib/auth.ts
 * Authentication helpers for API calls.
 */

/**
 * Returns the current JWT token from local storage or cookies.
 * For this implementation, we use a simple localStorage key.
 */
export function getJwtToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("micropay_auth_token");
}

/**
 * Sets the JWT token in local storage.
 */
export function setJwtToken(token: string): void {
  localStorage.setItem("micropay_auth_token", token);
}

/**
 * Clears the JWT token from local storage.
 */
export function clearJwtToken(): void {
  localStorage.removeItem("micropay_auth_token");
}
