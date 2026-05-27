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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isWalletReady, setIsWalletReady] = useState(false);

  useEffect(() => {
    let isActive = true;

    getConnectedPublicKey()
      .then((connectedPublicKey) => {
        if (!isActive) return;
        setPublicKey(connectedPublicKey);
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
        setPublicKey(nextPublicKey);
      },
      disconnectWallet: () => {
        clearWalletConnection();
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
