import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  disconnectWallet as clearWalletConnection,
  getConnectedPublicKey,
  signTransactionWithWallet,
} from "@/lib/wallet";
import {
  getNetworkConfig,
  setNetworkConfig,
  type NetworkConfig,
} from "@/lib/stellarConfig";

interface WalletContextValue {
  publicKey: string | null;
  network: NetworkConfig["network"];
  networkConfig: NetworkConfig;
  isWalletReady: boolean;
  connect: (nextPublicKey: string) => void;
  disconnect: () => void;
  connectWallet: (nextPublicKey: string) => void;
  disconnectWallet: () => void;
  signTransaction: (
    transactionXDR: string,
  ) => Promise<{ signedXDR: string | null; error: string | null }>;
  setNetwork: (config: NetworkConfig) => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const LAST_PUBLIC_KEY_STORAGE_KEY = "stellar-micropay:last-public-key";

function loadLastPublicKey() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(LAST_PUBLIC_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveLastPublicKey(publicKey: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (publicKey) {
      window.localStorage.setItem(LAST_PUBLIC_KEY_STORAGE_KEY, publicKey);
    } else {
      window.localStorage.removeItem(LAST_PUBLIC_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private browsing, full quota, etc.).
  }
}

/** Provides the wallet context, tracking the connected public key and restoring the last-connected wallet on mount. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(() =>
    loadLastPublicKey(),
  );
  const [isWalletReady, setIsWalletReady] = useState(false);
  const [networkConfig, setNetworkConfigState] = useState<NetworkConfig>(() => getNetworkConfig());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleNetworkChange = (e: Event) => {
      const customEvent = e as CustomEvent<NetworkConfig>;
      if (customEvent.detail) {
        setNetworkConfigState(customEvent.detail);
      } else {
        setNetworkConfigState(getNetworkConfig());
      }
    };
    window.addEventListener("stellar-micropay:network-changed", handleNetworkChange);
    return () => {
      window.removeEventListener("stellar-micropay:network-changed", handleNetworkChange);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    getConnectedPublicKey()
      .then((connectedPublicKey) => {
        if (!isActive) return;
        setPublicKey(connectedPublicKey);
        saveLastPublicKey(connectedPublicKey);
      })
      .finally(() => {
        if (isActive) {
          setIsWalletReady(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      publicKey,
      network: networkConfig.network,
      networkConfig,
      isWalletReady,
      connect: (nextPublicKey: string) => {
        saveLastPublicKey(nextPublicKey);
        setPublicKey(nextPublicKey);
      },
      disconnect: () => {
        clearWalletConnection();
        saveLastPublicKey(null);
        setPublicKey(null);
      },
      connectWallet: (nextPublicKey: string) => {
        saveLastPublicKey(nextPublicKey);
        setPublicKey(nextPublicKey);
      },
      disconnectWallet: () => {
        clearWalletConnection();
        saveLastPublicKey(null);
        setPublicKey(null);
      },
      signTransaction: async (transactionXDR: string) => {
        return signTransactionWithWallet(transactionXDR);
      },
      setNetwork: (config: NetworkConfig) => {
        setNetworkConfig(config);
        setNetworkConfigState(config);
      },
    }),
    [publicKey, isWalletReady, networkConfig]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/** Access the wallet context; throws if called outside a WalletProvider. */
export function useWallet() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}
