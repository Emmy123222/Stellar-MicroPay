/**
 * @file lib/stellarConfig.ts
 * @description Centralized configuration and Horizon server instantiation for Stellar MicroPay.
 */

import { Horizon, Networks } from "@stellar/stellar-sdk";

export interface NetworkConfig {
  network: "testnet" | "mainnet" | "custom";
  horizonUrl: string;
}

export const DEFAULT_CONFIGS: Record<"testnet" | "mainnet", NetworkConfig> = {
  testnet: {
    network: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  mainnet: {
    network: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
  },
};

export function getNetworkConfig(): NetworkConfig {
  if (typeof window === "undefined") {
    // Server-side: use env vars as fallback
    const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
    return DEFAULT_CONFIGS[network];
  }

  const stored = localStorage.getItem("stellar-micropay:network");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Invalid stored config, fall back to default
    }
  }

  // Default to testnet
  return DEFAULT_CONFIGS.testnet;
}

export function setNetworkConfig(config: NetworkConfig): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("stellar-micropay:network", JSON.stringify(config));
  }
}

// Get current network config
const config = getNetworkConfig();

// For backwards compatibility, keep these as computed values
export const NETWORK = config.network === "custom" ? "testnet" : config.network;
export const HORIZON_URL = config.horizonUrl;

/** The network passphrase is used to sign and verify transactions. */
export function getNetworkPassphrase(): string {
  const config = getNetworkConfig();
  return config.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

// For backwards compatibility
export const NETWORK_PASSPHRASE = getNetworkPassphrase();

/** Pre-configured Horizon server instance for the active network. */
let _server: Horizon.Server | null = null;
export function getServer(): Horizon.Server {
  const currentConfig = getNetworkConfig();
  if (!_server || _server.serverURL.toString() !== currentConfig.horizonUrl) {
    _server = new Horizon.Server(currentConfig.horizonUrl);
  }
  return _server;
}

// For backwards compatibility, export server as getter proxy
export const server = new Proxy({} as Horizon.Server, {
  get(target, prop) {
    return getServer()[prop as keyof Horizon.Server];
  },
});
