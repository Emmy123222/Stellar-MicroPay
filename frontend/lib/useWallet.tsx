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
} from "@/lib/wallet";

interface WalletContextValue {
  publicKey: string | null;
  isWalletReady: boolean;
  connectWallet: (nextPublicKey: string) => void;
  disconnectWallet: () => void;
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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(() => loadLastPublicKey());
  const [isWalletReady, setIsWalletReady] = useState(false);

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
      isWalletReady,
      connectWallet: (nextPublicKey: string) => {
        saveLastPublicKey(nextPublicKey);
        setPublicKey(nextPublicKey);
      },
      disconnectWallet: () => {
        clearWalletConnection();
        saveLastPublicKey(null);
        setPublicKey(null);
      },
    }),
    [publicKey, isWalletReady]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}
