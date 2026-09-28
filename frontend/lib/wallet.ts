/**
 * lib/wallet.ts
 * Freighter wallet integration for Stellar MicroPay.
 *
 * Freighter is a browser extension wallet for Stellar.
 * Install it at: https://freighter.app
 *
 * This module wraps the @stellar/freighter-api package with
 * friendly error messages and typed return values.
 */

import {
  isConnected,
  getPublicKey,
  signTransaction,
  requestAccess,
  isAllowed,
} from "@stellar/freighter-api";

import { getNetworkPassphrase, getNetworkConfig } from "./stellar";

// ─── SEP-0010 helpers ────────────────────────────────────────────────────────

let jwtToken: string | null = null;
export function setJwtToken(token: string | null) { jwtToken = token; }
export function getJwtToken() { return jwtToken; }

async function fetchAuthChallenge(publicKey: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  const res  = await fetch(`${base}/api/auth?account=${encodeURIComponent(publicKey)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch SEP-0010 challenge");
  const { transaction } = await res.json();
  return transaction;
}

async function verifyAuthChallenge(signedXDR: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  const res  = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ transaction: signedXDR }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "Auth failed" }));
    throw new Error(error || "SEP-0010 verification failed");
  }
  const { token } = await res.json();
  return token;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  error: string | null;
}

// ─── Browser detection ───────────────────────────────────────────────────────

export type SupportedBrowser = "chrome" | "firefox" | "other";

/**
 * Detect the user's browser to surface the correct extension store link.
 */
export function detectBrowser(): SupportedBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "firefox";
  // Chrome, Edge, Brave, Arc all include "Chrome" in UA
  if (ua.includes("Chrome")) return "chrome";
  return "other";
}

export const EXTENSION_URLS: Record<SupportedBrowser, string> = {
  chrome:
    "https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk",
  firefox:
    "https://addons.mozilla.org/en-US/firefox/addon/freighter/",
  other: "https://freighter.app",
};

// ─── Wallet detection ─────────────────────────────────────────────────────────

/**
 * Check whether the Freighter extension is installed in the browser.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const result = await isConnected();
    // isConnected returns { isConnected: boolean } or boolean depending on version
    if (typeof result === "object" && result !== null && "isConnected" in result) {
      return (result as { isConnected: boolean }).isConnected;
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Check if this site has already been granted access by the user.
 */
export async function hasSiteAccess(): Promise<boolean> {
  try {
    const result = await isAllowed();
    if (typeof result === "object" && result !== null && "isAllowed" in result) {
      return (result as { isAllowed: boolean }).isAllowed;
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

// ─── Connect / Disconnect ────────────────────────────────────────────────────

/**
 * Prompt the user to connect their Freighter wallet.
 * Returns the user's public key on success.
 */
export async function connectWallet(): Promise<{
  publicKey: string | null;
  error: string | null;
}> {
  // 1. Check extension is installed
  const installed = await isFreighterInstalled();
  if (!installed) {
    return {
      publicKey: null,
      error:
        "Freighter wallet is not installed. Visit https://freighter.app to install it.",
    };
  }

  try {
    // 2. Request access from the user
    await requestAccess();

    // 3. Get the public key
    const result = await getPublicKey();
    const publicKey =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as { publicKey: string }).publicKey
        : (result as string);

    if (!publicKey) {
      return { publicKey: null, error: "No public key returned from Freighter." };
    }

    return { publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // User rejected the connection
    if (message.includes("User declined")) {
      return {
        publicKey: null,
        error: "Connection rejected. Please approve the connection in Freighter.",
      };
    }

    return { publicKey: null, error: `Wallet connection failed: ${message}` };
  }
}

/**
 * Get the currently connected public key (if any) without prompting.
 */
export async function getConnectedPublicKey(): Promise<string | null> {
  try {
    const allowed = await hasSiteAccess();
    if (!allowed) return null;

    const result = await getPublicKey();
    const pk =
      typeof result === "object" && result !== null && "publicKey" in result
        ? (result as { publicKey: string }).publicKey
        : (result as string);
    return pk || null;
  } catch {
    return null;
  }
}

// ─── SEP-0010 auth flow ──────────────────────────────────────────────────────

/**
 * Full SEP-0010 authentication flow:
 * 1. Request a challenge transaction from the backend
 * 2. Sign it with Freighter
 * 3. Submit the signed transaction to receive a JWT
 */
export async function performSEP0010Auth(
  publicKey: string
): Promise<{ token: string | null; error: string | null }> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError } = await signTransactionWithWallet(challengeXDR);
    if (signError || !signedXDR) {
      return { token: null, error: signError || "Failed to sign challenge transaction" };
    }
    const token = await verifyAuthChallenge(signedXDR);
    setJwtToken(token);
    return { token, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: `Authentication failed: ${msg}` };
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Wallet type for signing strategy.
 */
export type WalletType = "freighter" | "ledger";

/**
 * Ask Freighter to sign a transaction XDR.
 * Returns the signed XDR string.
 */
export async function signTransactionWithWallet(
  transactionXDR: string,
  walletType: WalletType = "freighter"
): Promise<{ signedXDR: string | null; error: string | null }> {
  if (walletType === "ledger") {
    return signTransactionWithLedger(transactionXDR);
  }

  try {
    const config = getNetworkConfig();
    const network = config.network === "mainnet" ? "MAINNET" : "TESTNET";

    const result = await signTransaction(transactionXDR, {
      networkPassphrase: getNetworkPassphrase(),
      network,
    });

    const signedXDR =
      typeof result === "object" && result !== null && "signedTransaction" in result
        ? (result as { signedTransaction: string }).signedTransaction
        : (result as string);

    return { signedXDR, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("User declined") || message.includes("rejected")) {
      return {
        signedXDR: null,
        error: "Transaction signing was rejected by the user.",
      };
    }

    return { signedXDR: null, error: `Signing failed: ${message}` };
  }
}

/**
 * Disconnect the wallet. Since Freighter doesn't provide a disconnect API,
 * this clears the local connection state. The actual disconnect happens
 * when the app's state is updated.
 */
export function disconnectWallet(): void {
  // Freighter doesn't expose an explicit disconnect API, so the app clears
  // any local auth state and lets React own the connected wallet lifecycle.
  setJwtToken(null);
}

// ─── Ledger Hardware Wallet Support ─────────────────────────────────────────────

let ledgerTransport: any = null;
let ledgerApp: any = null;

/**
 * Check if Ledger hardware wallet is supported (WebUSB available).
 */
export const isLedgerSupported = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  if (!navigator || !(navigator as any).usb) return false;
  
  try {
    // Dynamic import to avoid SSR issues
    const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
    return TransportWebUSB.isSupported();
  } catch {
    return false;
  }
};

/**
 * Get public key from Ledger device.
 */
export async function getLedgerPublicKey(): Promise<{ publicKey: string | null; error: string | null }> {
  try {
    const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
    const AppStellar = (await import("@ledgerhq/hw-app-str")).default;
    
    ledgerTransport = await TransportWebUSB.create();
    ledgerApp = new AppStellar(ledgerTransport);
    
    const result = await ledgerApp.getPublicKey("", "44'", true);
    const publicKey = result.publicKey;
    
    await ledgerTransport.close();
    ledgerTransport = null;
    ledgerApp = null;
    
    return { publicKey, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    
    if (ledgerTransport) {
      try {
        await ledgerTransport.close();
      } catch {
        // Ignore close errors
      }
      ledgerTransport = null;
      ledgerApp = null;
    }
    
    if (message.includes("No device found")) {
      return { publicKey: null, error: "Ledger device not found. Please connect your Ledger and unlock it." };
    }
    if (message.includes("Locked")) {
      return { publicKey: null, error: "Ledger device is locked. Please unlock it." };
    }
    if (message.includes("Stellar app is not open")) {
      return { publicKey: null, error: "Please open the Stellar app on your Ledger device." };
    }
    
    return { publicKey: null, error: `Ledger error: ${message}` };
  }
}

/**
 * Sign transaction with Ledger device.
 */
export async function signTransactionWithLedger(xdr: string): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
    const AppStellar = (await import("@ledgerhq/hw-app-str")).default;
    
    ledgerTransport = await TransportWebUSB.create();
    ledgerApp = new AppStellar(ledgerTransport);
    
    const result = await ledgerApp.signTransaction("", xdr);
    const signedXDR = result.signature;
    
    await ledgerTransport.close();
    ledgerTransport = null;
    ledgerApp = null;
    
    return { signedXDR, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    
    if (ledgerTransport) {
      try {
        await ledgerTransport.close();
      } catch {
        // Ignore close errors
      }
      ledgerTransport = null;
      ledgerApp = null;
    }
    
    if (message.includes("No device found")) {
      return { signedXDR: null, error: "Ledger device not found. Please connect your Ledger and unlock it." };
    }
    if (message.includes("Locked")) {
      return { signedXDR: null, error: "Ledger device is locked. Please unlock it." };
    }
    if (message.includes("Stellar app is not open")) {
      return { signedXDR: null, error: "Please open the Stellar app on your Ledger device." };
    }
    if (message.includes("Transaction rejected")) {
      return { signedXDR: null, error: "Transaction rejected on Ledger device." };
    }
    
    return { signedXDR: null, error: `Ledger signing error: ${message}` };
  }
}
