import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  disconnectWallet as clearWalletConnection,
  getConnectedPublicKey,
} from "@/lib/wallet";
import Toast from "@/components/Toast";

interface WalletContextValue {
  publicKey: string | null;
  isWalletReady: boolean;
  connectWallet: (nextPublicKey: string) => void;
  disconnectWallet: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

// Freighter's extension API (@stellar/freighter-api) exposes no
// accountChanged/network-changed event to subscribe to, so an account
// switch made inside the extension is only observable by re-reading the
// connected public key and diffing it against what the app last saw.
const ACCOUNT_CHANGE_POLL_MS = 3000;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isWalletReady, setIsWalletReady] = useState(false);
  const [accountChangeToast, setAccountChangeToast] = useState<string | null>(null);
  const publicKeyRef = useRef<string | null>(null);

  useEffect(() => {
    publicKeyRef.current = publicKey;
  }, [publicKey]);

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

  useEffect(() => {
    const interval = window.setInterval(() => {
      getConnectedPublicKey().then((connectedPublicKey) => {
        const previousPublicKey = publicKeyRef.current;
        if (
          previousPublicKey &&
          connectedPublicKey &&
          connectedPublicKey !== previousPublicKey
        ) {
          setPublicKey(connectedPublicKey);
          setAccountChangeToast("Freighter account changed — wallet updated");
        }
      });
    }, ACCOUNT_CHANGE_POLL_MS);

    return () => window.clearInterval(interval);
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

  return (
    <WalletContext.Provider value={value}>
      {children}
      {accountChangeToast && (
        <Toast
          message={accountChangeToast}
          type="info"
          onClose={() => setAccountChangeToast(null)}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}
