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

import { NETWORK_PASSPHRASE } from "./stellar";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import StellarApp from "@ledgerhq/hw-app-stellar";

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
 * Ask Freighter to sign a transaction XDR.
 * Returns the signed XDR string.
 */
export async function signTransactionWithWallet(
  transactionXDR: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
      ? "MAINNET"
      : "TESTNET";

    const result = await signTransaction(transactionXDR, {
      networkPassphrase: NETWORK_PASSPHRASE,
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

// ─── Ledger Hardware Wallet Support ───────────────────────────────────────────

/**
 * Check if WebHID is supported and a Ledger device might be available.
 */
export async function isLedgerSupported(): Promise<boolean> {
  try {
    // Check if WebHID is supported
    if (typeof navigator === "undefined" || !navigator.hid) {
      return false;
    }
    
    // Try to create a transport to test connectivity
    const transport = await TransportWebHID.create();
    await transport.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the public key from a Ledger device.
 * @param accountPath - BIP32 path (default: "44'/148'/0'")
 * @param confirmOnDevice - Whether to require confirmation on the device
 */
export async function getLedgerPublicKey(
  accountPath: string = "44'/148'/0'",
  confirmOnDevice: boolean = false
): Promise<{ publicKey: string | null; error: string | null }> {
  try {
    // Check WebHID support first
    if (typeof navigator === "undefined" || !navigator.hid) {
      return {
        publicKey: null,
        error: "WebHID is not supported in this browser. Use Chrome, Edge, or another Chromium-based browser.",
      };
    }

    // Create transport and connect to Ledger
    const transport = await TransportWebHID.create();
    const stellar = new StellarApp(transport);

    try {
      const result = await stellar.getPublicKey(accountPath, confirmOnDevice);
      const publicKey = result.publicKey;
      
      if (!publicKey) {
        return { publicKey: null, error: "No public key returned from Ledger device." };
      }

      return { publicKey, error: null };
    } finally {
      await transport.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Handle common Ledger errors
    if (message.includes("Device not found") || message.includes("No device selected")) {
      return {
        publicKey: null,
        error: "Ledger device not found. Make sure your Ledger is connected and unlocked.",
      };
    }

    if (message.includes("App not open") || message.includes("6985")) {
      return {
        publicKey: null,
        error: "Stellar app is not open on your Ledger device. Open the Stellar app and try again.",
      };
    }

    if (message.includes("6986") || message.includes("denied") || message.includes("rejected")) {
      return {
        publicKey: null,
        error: "Action rejected on the Ledger device. Please try again.",
      };
    }

    if (message.includes("6480")) {
      return {
        publicKey: null,
        error: "Stellar app is not installed on your Ledger device. Install it from Ledger Live.",
      };
    }

    return { publicKey: null, error: `Ledger connection failed: ${message}` };
  }
}

/**
 * Sign a transaction using a Ledger device.
 * @param transactionXDR - The transaction XDR to sign
 * @param accountPath - BIP32 path (default: "44'/148'/0'")
 */
export async function signTransactionWithLedger(
  transactionXDR: string,
  accountPath: string = "44'/148'/0'"
): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    // Check WebHID support first
    if (typeof navigator === "undefined" || !navigator.hid) {
      return {
        signedXDR: null,
        error: "WebHID is not supported in this browser. Use Chrome, Edge, or another Chromium-based browser.",
      };
    }

    // Create transport and connect to Ledger
    const transport = await TransportWebHID.create();
    const stellar = new StellarApp(transport);

    try {
      const result = await stellar.signTransaction(accountPath, transactionXDR);
      const signedXDR = result.signature;
      
      if (!signedXDR) {
        return { signedXDR: null, error: "No signature returned from Ledger device." };
      }

      return { signedXDR, error: null };
    } finally {
      await transport.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Handle common Ledger errors
    if (message.includes("Device not found") || message.includes("No device selected")) {
      return {
        signedXDR: null,
        error: "Ledger device not found. Make sure your Ledger is connected and unlocked.",
      };
    }

    if (message.includes("App not open") || message.includes("6985")) {
      return {
        signedXDR: null,
        error: "Stellar app is not open on your Ledger device. Open the Stellar app and try again.",
      };
    }

    if (message.includes("6986") || message.includes("denied") || message.includes("rejected")) {
      return {
        signedXDR: null,
        error: "Transaction signing was rejected on the Ledger device.",
      };
    }

    if (message.includes("6480")) {
      return {
        signedXDR: null,
        error: "Stellar app is not installed on your Ledger device. Install it from Ledger Live.",
      };
    }

    return { signedXDR: null, error: `Ledger signing failed: ${message}` };
  }
}
