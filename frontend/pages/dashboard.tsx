/**
 * pages/dashboard.tsx
 * Dashboard with wallet summary, payment stats, payment actions, and recent activity.
 *
 * Notification implementation uses the Push API as per MDN:
 * https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 *
 * Flow:
 *  1. Register a service worker (required by Push API).
 *  2. Call Notification.requestPermission() on user gesture.
 *  3. Subscribe via PushManager.subscribe() with userVisibleOnly + VAPID key.
 *  4. The service worker's push event handler calls showNotification().
 */

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Link from "next/link";
import { useRouter } from "next/router";
import PaymentLinkGenerator from "@/components/PaymentLinkGenerator";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import BatchPaymentForm from "@/components/BatchPaymentForm";
import TransactionList from "@/components/TransactionList";
import Toast from "@/components/Toast";
import QRCodeModal from "@/components/QRCodeModal";
import ExternalPaymentBanner from "@/components/ExternalPaymentBanner";
import PaymentRequestGenerator from "@/pages/PaymentRequestGenerator";
import {
  getXLMBalance,
  getUSDCBalance,
  getFriendBotFunding,
  waitForAccountFunding,
  ACCOUNT_NOT_FOUND_ERROR,
  streamPayments,
  getRecentPaymentsForStats,
  PaymentRecord,
} from "@/lib/stellar";
import { formatUSD, copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";
import { URIParseResult, uriToPrefillData } from "@/lib/sep0007";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
  stellarURI?: URIParseResult | null;
}

interface PaymentStats {
  publicKey: string;
  totalSentXLM: string;
  totalReceivedXLM: string;
  sentCount: number;
  receivedCount: number;
  totalTransactions: number;
}

export default function Dashboard({ publicKey, onConnect, stellarURI }: DashboardProps) {
  const [xlmBalance, setXlmBalance]   = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { visible: toastVisible, message: toastMessage, showToast } = useToast();
  const [showQRModal, setShowQRModal] = useState(false);
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);

  const isTestnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet";
  const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [accountNotFound, setAccountNotFound] = useState(false);

  const router = useRouter();
  const [activePaymentTab, setActivePaymentTab] = useState<"single" | "batch">("single");

  // Build prefill object from query parameters (e.g., from contacts page)
  const prefill = router.query.prefillDestination
    ? {
        destination: router.query.prefillDestination as string,
        amount: "",
        memo: "",
      }
    : null;
  const [friendbotLoading, setFriendbotLoading] = useState(false);
  const [friendbotSuccessMessage, setFriendbotSuccessMessage] = useState<string | null>(null);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [paymentStatsLoading, setPaymentStatsLoading] = useState(false);
  const [paymentStatsError, setPaymentStatsError] = useState<string | null>(null);
  const [incomingPayment, setIncomingPayment] = useState<PaymentRecord | null>(null);
  const [showExternalBanner, setShowExternalBanner] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;

    setBalanceLoading(true);
    setAccountNotFound(false);

    try {
      const [bal, usdc] = await Promise.all([
        getXLMBalance(publicKey),
        getUSDCBalance(publicKey),
      ]);
      setXlmBalance(bal);
      setUsdcBalance(usdc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (
        msg === ACCOUNT_NOT_FOUND_ERROR ||
        msg.includes("404") ||
        msg.toLowerCase().includes("not found")
      ) {
        setAccountNotFound(true);
      }
      setXlmBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [publicKey]);

  const fetchPaymentStats = useCallback(async () => {
    if (!publicKey) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

    setPaymentStatsLoading(true);
    setPaymentStatsError(null);

    try {
      const headers: HeadersInit = {};
      const token = getJwtToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(
        `${apiBase}/api/payments/${encodeURIComponent(publicKey)}/stats`,
        { headers }
      );

      if (!response.ok) {
        throw new Error("Unable to load payment stats right now.");
      }

      const payload = await response.json();
      const data = payload?.data;

      if (
        !payload?.success ||
        !data ||
        typeof data.totalSentXLM !== "string" ||
        typeof data.totalReceivedXLM !== "string" ||
        typeof data.totalTransactions !== "number"
      ) {
        throw new Error("Payment stats response was invalid.");
      }

      setPaymentStats({
        publicKey: data.publicKey,
        totalSentXLM: data.totalSentXLM,
        totalReceivedXLM: data.totalReceivedXLM,
        sentCount: Number(data.sentCount ?? 0),
        receivedCount: Number(data.receivedCount ?? 0),
        totalTransactions: data.totalTransactions,
      });
    } catch {
      setPaymentStats(null);
      setPaymentStatsError("Could not load your payment stats.");
    } finally {
      setPaymentStatsLoading(false);
    }
  }, [publicKey]);

  const fetchSpendingHistory = useCallback(async () => {
    if (!publicKey) return;

    setSpendingLoading(true);
    try {
      const payments = await getRecentPaymentsForStats(publicKey, 200);
      
      // Group by calendar month (last 6 months)
      const now = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          month: d.toLocaleString("default", { month: "short" }),
          monthIndex: d.getMonth(),
          year: d.getFullYear(),
          sent: 0,
          received: 0,
          label: d.toLocaleString("default", { month: "long", year: "numeric" }),
        });
      }

      payments.forEach((p) => {
        const pDate = new Date(p.createdAt);
        const m = months.find(
          (m) =>
            m.monthIndex === pDate.getMonth() && m.year === pDate.getFullYear()
        );
        if (m) {
          const amount = parseFloat(p.amount);
          if (p.type === "sent") {
            m.sent += amount;
          } else {
            m.received += amount;
          }
        }
      });

      setSpendingData(months);
    } catch (err) {
      console.error("Failed to fetch spending history:", err);
    } finally {
      setSpendingLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchSpendingHistory();
  }, [fetchSpendingHistory, refreshKey]);

  const handleFriendbot = async () => {
    if (!publicKey) return;
    if (!isTestnet) {
      showToast("Friendbot is only available on testnet.");
      return;
    }

    setFriendbotLoading(true);
    setFriendbotSuccessMessage(null);

    try {
      await getFriendBotFunding(publicKey);

      const funded = await waitForAccountFunding(publicKey, {
        intervalMs: 1000,
        timeoutMs: 20000,
      });

      if (!funded) {
        showToast("Funding sent, but account is still syncing. Please refresh shortly.");
        return;
      }

      setFriendbotSuccessMessage("Success! 10,000 XLM has been credited to your wallet.");
      showToast("Wallet funded with 10,000 XLM.");

      setRefreshKey((k) => k + 1);
    } catch {
      showToast("Friendbot funding failed. Please try again.");
    } finally {
      setFriendbotLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance, refreshKey]);

  useEffect(() => {
    setFriendbotSuccessMessage(null);
  }, [publicKey]);

  useEffect(() => {
    fetchPaymentStats();
  }, [fetchPaymentStats, refreshKey]);

  useEffect(() => {
    fetchSparklineData();
  }, [fetchSparklineData, refreshKey]);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd")
      .then((res) => res.json())
      .then((data) => setXlmPrice(data?.stellar?.usd ?? null))
      .catch(() => setXlmPrice(null));
  }, [refreshKey]);

  // Sync notification permission state on mount and whenever the user
  // returns to the tab — they may have changed browser-level settings.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const syncPermission = () => {
      const perm = Notification.permission;
      setNotificationPermission(perm);
      // If permission was revoked externally, disable notifications automatically.
      if (perm !== 'granted') {
        setNotificationEnabled(false);
        localStorage.setItem('notificationOptIn', 'false');
      }
    };

    syncPermission();
    const optIn = localStorage.getItem('notificationOptIn') === 'true';
    setNotificationEnabled(optIn && Notification.permission === 'granted');

    window.addEventListener('focus', syncPermission);
    return () => window.removeEventListener('focus', syncPermission);
  }, []);

  const handleCopyAddress = async () => {
    if (!publicKey) return;

    const ok = await copyToClipboard(publicKey);
    if (ok) showToast("Address copied!");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Onboarding tour logic
  useEffect(() => {
    if (publicKey) {
      const hasSeenTour = localStorage.getItem("stellar-micropay:onboarding-completed");
      if (!hasSeenTour) {
        setShowOnboardingTour(true);
      }
    }
  }, [publicKey]);

  const handleTourComplete = () => {
    setShowOnboardingTour(false);
    localStorage.setItem("stellar-micropay:onboarding-completed", "true");
  };

  const handleTourSkip = () => {
    setShowOnboardingTour(false);
    localStorage.setItem("stellar-micropay:onboarding-completed", "true");
  };

  const handlePaymentSuccess = () => {
    setTimeout(() => {
      setRefreshKey((k) => k + 1);
    }, 2000);
  };

  /**
   * Subscribe to the Push API using the correct MDN-documented flow:
   *  1. Register (or retrieve) the service worker.
   *  2. Request notification permission on the user gesture.
   *  3. Call PushManager.subscribe() with userVisibleOnly + VAPID key.
   *  4. Send the PushSubscription endpoint to the server for future pushes.
   *
   * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
   */
  const subscribeToPush = async (): Promise<boolean> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast('Push notifications are not supported in this browser.');
      return false;
    }

    // Step 1 — Register the service worker (idempotent: returns existing if already registered).
    const registration = await navigator.serviceWorker.register('/sw.js');

    // Step 2 — Request notification permission. Must be called directly inside
    // a user-gesture handler; async chains that break the gesture context will
    // be silently rejected by some browsers.
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission !== 'granted') {
      showToast('Notification permission was not granted.');
      return false;
    }

    // Step 3 — Subscribe via PushManager.
    // userVisibleOnly: true is required by Chrome/Edge.
    // applicationServerKey is the VAPID public key from the environment.
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      // No VAPID key configured — fall back to permission-only mode (no
      // server-pushed messages, but in-app bubble notifications still work).
      console.warn('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set. Server push disabled.');
      return true;
    }

    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription =
      existingSubscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));

    // Step 4 — Send the subscription to your server so it can push messages later.
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
    await fetch(`${apiBase}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, publicKey }),
    }).catch((err) => {
      // Non-fatal: subscription still works for same-session in-app notifications.
      console.warn('Could not register push subscription with server:', err);
    });

    return true;
  };

  const handleToggleNotifications = async () => {
    // --- Disable ---
    if (notificationEnabled) {
      localStorage.setItem('notificationOptIn', 'false');
      setNotificationEnabled(false);
      showToast('Payment notifications disabled');
      return;
    }

    // --- Enable ---
    if (!('Notification' in window)) {
      showToast('This browser does not support notifications.');
      return;
    }

    if (Notification.permission === 'denied') {
      showToast('Notifications are blocked. Please enable them in your browser settings.');
      return;
    }

    try {
      const subscribed = await subscribeToPush();
      if (!subscribed) return;

      localStorage.setItem('notificationOptIn', 'true');
      setNotificationEnabled(true);
      showToast('Payment notifications enabled');

      // Confirm with an immediate notification so the user sees it working.
      // Use showNotification() via the service worker registration —
      // this is the Push API-correct method, not new Notification().
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification('Stellar Pay', {
        body: 'You will now receive notifications for incoming payments.',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
      });
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
      showToast('Could not enable notifications. Please try again.');
    }
  };

  /**
   * Dev-only test: fires a notification via the service worker registration
   * (showNotification) to validate the full Push API path, not just UI state.
   */
  const handleTestNotification = async () => {
    if (!notificationEnabled) return;

    // In-app bubble for immediate visual feedback
    setBubbleMessage('You received 10.00 XLM');
    setShowBubble(true);
    setTimeout(() => setShowBubble(false), 3000);

    // Real notification via service worker — validates the actual push path
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification('Stellar Pay — Test', {
          body: 'You received 10.00 XLM',
          icon: '/favicon.svg',
          badge: '/favicon.svg',
        });
      } catch (err) {
        console.error('Test notification failed:', err);
      }
    }
  };

  // Real-time payment streaming for the connected wallet.
  // On incoming payment: show OS notification when page is hidden,
  // in-app bubble when page is visible.
  useEffect(() => {
    if (!publicKey) return;

    const unsubscribe = streamPayments(
      publicKey,
      async (payment) => {
        if (payment.type === 'received') {
          showToast(`Received ${payment.amount} ${payment.asset}`);

          if (notificationEnabled && Notification.permission === 'granted') {
            if (document.visibilityState === 'hidden') {
              // Page is not visible — use the service worker showNotification()
              // so the OS notification tray receives it.
              try {
                const registration = await navigator.serviceWorker.ready;
                await registration.showNotification('Stellar Pay — Payment received', {
                  body: `You received ${payment.amount} ${payment.asset}`,
                  icon: '/favicon.svg',
                  badge: '/favicon.svg',
                });
              } catch (err) {
                console.error('showNotification failed:', err);
              }
            } else {
              // Page is visible — in-app bubble is less intrusive.
              setBubbleMessage(`You received ${payment.amount} ${payment.asset}`);
              setShowBubble(true);
              setTimeout(() => setShowBubble(false), 3000);
            }
          }

          // Refresh XLM balance after an incoming payment
          try {
            const bal = await getXLMBalance(publicKey);
            setXlmBalance(bal);
          } catch {
            // keep previous balance on failure
          }
        }

        setIncomingPayment(payment);
      },
      (error) => {
        console.error('Dashboard payment stream error:', error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [publicKey, showToast, notificationEnabled]);

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">Dashboard</h1>
          <p className="text-slate-400">Connect your wallet to get started</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Dashboard</h1>
        <p className="text-slate-400 text-sm">Send and receive XLM globally</p>
        <div className="mt-4">
          <button
            onClick={handleToggleNotifications}
            disabled={notificationPermission === 'denied'}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-stellar-400 hover:text-stellar-300 disabled:bg-white/5 disabled:text-slate-500 disabled:border-white/5 disabled:cursor-not-allowed transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {notificationEnabled
                ? 'Disable payment notifications'
                : notificationPermission === 'denied'
                ? 'Notifications blocked'
                : 'Enable payment notifications'}
            </span>
            {notificationEnabled
              ? <BellOffIcon className="w-4 h-4" />
              : <BellIcon className="w-4 h-4" />}
          </button>

          {/* Test button: dev-only, shown only when notifications are enabled */}
          {process.env.NODE_ENV === 'development' && notificationEnabled && (
            <button
              onClick={handleTestNotification}
              className="mt-2 text-xs text-slate-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <TestIcon className="w-3.5 h-3.5" /> Test notification
            </button>
          )}
        </div>
      </div>

      <PaymentStatsWidget
        stats={paymentStats}
        loading={paymentStatsLoading}
        error={paymentStatsError}
        onRetry={fetchPaymentStats}
      />

      <MonthlySpendingChart 
        data={spendingData} 
        loading={spendingLoading}
        onBarClick={setSelectedMonth}
      />

      {selectedMonth && (
        <div className="mb-8 p-4 rounded-xl bg-stellar-500/5 border border-stellar-500/10 flex items-center justify-between animate-fade-in">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
              Selected Period: {selectedMonth.label}
            </p>
            <div className="flex items-center gap-6">
              <div>
                <span className="text-xs text-slate-400">Total Sent</span>
                <p className="text-lg font-bold text-white">{selectedMonth.sent.toFixed(2)} XLM</p>
              </div>
              <div>
                <span className="text-xs text-slate-400">Total Received</span>
                <p className="text-lg font-bold text-stellar-400">{selectedMonth.received.toFixed(2)} XLM</p>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setSelectedMonth(null)}
            className="p-2 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">Wallet Address</p>
            <span className="font-mono text-sm text-slate-300 break-all select-text cursor-text">
              {publicKey}
            </span>
            <button
              onClick={handleCopyAddress}
              className="mt-2 text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" /> Copied!
                </>
              ) : (
                <>
                  <CopyIcon className="w-3.5 h-3.5" /> Copy address
                </>
              )}
            </button>
          </div>

          <div className="sm:text-right flex-shrink-0">
            <p className="label mb-1">XLM Balance</p>
            {balanceLoading ? (
              <div className="h-8 w-36 bg-white/10 rounded-lg animate-pulse" />
            ) : xlmBalance !== null ? (
              <div>
                <div className="font-display text-3xl font-bold text-white">
                  {parseFloat(xlmBalance).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-stellar-400 text-xl ml-2">XLM</span>
                </div>
                {xlmPrice !== null && (
                  <p className="text-sm text-slate-400 mt-0.5">
                    {formatUSD(parseFloat(xlmBalance) * xlmPrice)}
                  </p>
                )}
                {!sparklineLoading && sparklineData.length > 0 && (
                  <div className="mt-3">
                    <BalanceSparkline data={sparklineData} />
                  </div>
                )}
                <button
                  onClick={fetchBalance}
                  className="mt-1 text-xs text-slate-500 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end cursor-pointer"
                >
                  <RefreshIcon className="w-3 h-3" /> Refresh
                </button>
              </div>
            ) : accountNotFound && isTestnet ? (
              <div className="sm:text-right">
                <p className="text-amber-400 text-sm mb-2">Account not funded yet</p>
                <p className="text-xs text-slate-400">
                  Use the funding card below to credit your wallet on testnet.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-slate-500 text-sm">Failed to load</p>
                <button
                  onClick={fetchBalance}
                  className="text-xs text-stellar-400 hover:underline cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {friendbotSuccessMessage && (
              <p className="text-xs text-emerald-400 mt-2">{friendbotSuccessMessage}</p>
            )}
          </div>
        </div>

        {process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet" && (
          <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2 text-xs text-amber-400/80">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            You&apos;re on <strong>Testnet</strong> — funds are not real.{" "}
            <a
              href="https://friendbot.stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-300"
            >
              Get test XLM
            </a>
          </div>
        )}
      </div>

      {accountNotFound && isTestnet && (
        <div className="card mb-6 border-amber-500/30 bg-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="font-semibold text-white mb-1">Fund Testnet Wallet</p>
              <p className="text-sm text-amber-200/90">
                Your wallet is not funded yet. Click once to receive 10,000 XLM from Friendbot.
              </p>
              {friendbotSuccessMessage && (
                <p className="text-sm text-emerald-400 mt-2">{friendbotSuccessMessage}</p>
              )}
            </div>

            <button
              onClick={handleFriendbot}
              disabled={friendbotLoading}
              className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-black font-semibold text-sm py-2 px-4 rounded-lg transition-colors cursor-pointer"
            >
              {friendbotLoading ? (
                <>
                  <SpinnerIcon className="w-4 h-4 animate-spin" /> Funding...
                </>
              ) : (
                <>
                  <DropIcon className="w-4 h-4" /> Fund Testnet Wallet
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* USDC balance card — shown only when account has USDC trustline */}
      {usdcBalance !== null && (
        <div className="card mb-6 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-blue-500/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="label mb-1">USDC Balance</p>
              <div className="font-display text-3xl font-bold text-white">
                {parseFloat(usdcBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                <span className="text-blue-400 text-xl ml-2">USDC</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* External payment banner */}
      {stellarURI && stellarURI.success && stellarURI.isExternal && showExternalBanner && (
        <ExternalPaymentBanner
          message={stellarURI.data?.msg}
          originDomain={stellarURI.data?.originDomain}
          onDismiss={() => setShowExternalBanner(false)}
        />
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="card mb-6 bg-cosmos-950/80 border-white/10">
            <div className="flex gap-2 p-2 rounded-3xl bg-white/5">
              <button
                type="button"
                onClick={() => setActivePaymentTab("single")}
                className={`rounded-3xl px-4 py-2 text-sm font-semibold transition ${
                  activePaymentTab === "single"
                    ? "bg-stellar-400 text-black"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Send XLM
              </button>
              <button
                type="button"
                onClick={() => setActivePaymentTab("batch")}
                className={`rounded-3xl px-4 py-2 text-sm font-semibold transition ${
                  activePaymentTab === "batch"
                    ? "bg-stellar-400 text-black"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Batch Send
              </button>
            </div>
          </div>

          {activePaymentTab === "single" ? (
            <SendPaymentForm
              key={refreshKey}
              publicKey={publicKey}
              xlmBalance={xlmBalance || "0"}
              usdcBalance={usdcBalance}
              onSuccess={handlePaymentSuccess}
              prefill={stellarURI && stellarURI.success ? uriToPrefillData(stellarURI.data!) : null}
            />
          ) : (
            <BatchPaymentForm
              publicKey={publicKey}
              xlmBalance={xlmBalance || "0"}
              onBatchSuccess={handlePaymentSuccess}
            />
          )}
        </div>

        <div className="lg:col-span-1">
          <PaymentRequestGenerator />
        </div>

        <div className="lg:col-span-1">
          <div className="card h-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-stellar-400" />
                Recent Activity
              </h2>
              <Link
                href="/transactions"
                className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
              >
                View all →
              </Link>
            </div>
            <TransactionList key={refreshKey} publicKey={publicKey} limit={5} compact />
          </div>
        </div>
      </div>

      <BubbleNotification message={bubbleMessage} visible={showBubble} />
      <Toast message={toastMessage} visible={toastVisible} />
      <QRCodeModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        publicKey={publicKey}
      />
      <OnboardingTour
        isVisible={showOnboardingTour}
        onComplete={handleTourComplete}
        onSkip={handleTourSkip}
      />
    </div>
  );
}

function BubbleNotification({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'
      }`}
    >
      <div className="bg-stellar-500 text-white px-4 py-2 rounded-lg shadow-lg max-w-xs">
        <p className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">{message}</p>
      </div>
    </div>
  );
}

function PaymentStatsWidget({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: PaymentStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6"
        aria-label="Payment stats loading"
      >
        <span className="sr-only">Loading payment stats</span>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="card border-white/10 bg-white/[0.03] animate-pulse"
          >
            <div className="h-3 w-24 rounded bg-white/10 mb-3" />
            <div className="h-8 w-32 rounded bg-white/10 mb-2" />
            <div className="h-3 w-20 rounded bg-white/10" />
          </div>
        ))}
      </section>
    );
  }

  if (error) {
    return (
      <section className="card mb-6 border-red-500/20 bg-red-500/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Payment summary</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
          <button onClick={onRetry} className="btn-secondary text-sm px-4 py-2">
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!stats) return null;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
      <StatsCard
        label="Total Sent"
        value={formatStatsXLM(stats.totalSentXLM)}
        helper={`${stats.sentCount} outgoing payment${stats.sentCount === 1 ? "" : "s"}`}
      />
      <StatsCard
        label="Total Received"
        value={formatStatsXLM(stats.totalReceivedXLM, "received")}
        helper={`${stats.receivedCount} incoming payment${stats.receivedCount === 1 ? "" : "s"}`}
      />
      <StatsCard
        label="Transactions"
        value={stats.totalTransactions.toLocaleString("en-US")}
        helper="Across sent and received activity"
      />
    </section>
  );
}

function MonthlySpendingChart({
  data,
  loading,
  onBarClick,
}: {
  data: any[];
  loading: boolean;
  onBarClick: (data: any) => void;
}) {
  if (loading && data.length === 0) {
    return (
      <div className="card mb-6 h-[350px] animate-pulse bg-white/[0.03] border-white/10" />
    );
  }

  return (
    <div className="card mb-6 overflow-hidden">
      <h2 className="font-display text-lg font-semibold text-white mb-6">
        Monthly Spending (XLM)
      </h2>
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            onClick={(state) =>
              state &&
              state.activePayload &&
              onBarClick(state.activePayload[0].payload)
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
              }}
              itemStyle={{ color: "#38bdf8" }}
            />
            <Bar dataKey="sent" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatsCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="card border-white/10 bg-white/[0.03]">
      <p className="label mb-2">{label}</p>
      <p className="font-display text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400 mt-2">{helper}</p>
    </div>
  );
}

function formatStatsXLM(amount: string, suffix = "sent") {
  const value = parseFloat(amount);

  if (Number.isNaN(value)) return `0.00 XLM ${suffix}`;

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })} XLM ${suffix}`;
}

// ─── Sparkline chart ─────────────────────────────────────────────────────────

/**
 * Inline SVG sparkline showing balance change over the last N transactions.
 * Green when the overall trend is upward, red when downward.
 * Hover tooltip shows the running balance delta at each data point.
 */
function BalanceSparkline({ data }: { data: number[] }) {
  const W = 160;
  const H = 40;
  const PAD = 4;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero for flat lines

  const points = data.map((v, i) => {
    const x = PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return { x, y, value: v };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  const trend = data[data.length - 1] >= data[0];
  const color = trend ? "#22c55e" : "#ef4444"; // green-500 / red-500
  const fillColor = trend ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";

  // Closed path for the fill area under the line
  const fillPath =
    `M ${points[0].x},${H - PAD} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${H - PAD} Z`;

  return (
    <div className="relative inline-block" aria-label="Balance sparkline chart">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Balance trend: ${trend ? "upward" : "downward"}`}
      >
        {/* Fill area */}
        <path d={fillPath} fill={fillColor} />
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Interactive dots with tooltips */}
        {points.map((p, i) => (
          <g key={i} className="group">
            <circle
              cx={p.x}
              cy={p.y}
              r={5}
              fill="transparent"
              className="cursor-pointer"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill={color}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
            {/* SVG foreignObject tooltip */}
            <foreignObject
              x={Math.min(p.x - 36, W - 76)}
              y={p.y < H / 2 ? p.y + 6 : p.y - 30}
              width={72}
              height={24}
              className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity overflow-visible"
            >
              <div
                className="bg-cosmos-900 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white whitespace-nowrap text-center"
                style={{ fontSize: "10px" }}
              >
                {p.value >= 0 ? "+" : ""}
                {p.value.toFixed(4)} XLM
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
      <p className="text-xs mt-0.5" style={{ color, fontSize: "10px" }}>
        {trend ? "▲ Upward trend" : "▼ Downward trend"}
      </p>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
      />
    </svg>
  );
}

function DropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.183.394l-1.154.908a2.4 2.4 0 00-.33 3.58 2.4 2.4 0 003.58-.33l.908-1.154a2 2 0 01.394-1.183L9.12 16.5a2 2 0 00.517-3.86l-.158-.318a6 6 0 01.517-3.86l.477-2.387a2 2 0 01.547-1.022l1.09-1.09a2.4 2.4 0 013.394 0 2.4 2.4 0 010 3.394l-1.09 1.09z"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

function BellOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.172 9.172a4 4 0 015.656 5.656M9.172 9.172A4 4 0 0115 7.858V7a3 3 0 00-6 0v.858m0 1.314A4 4 0 009 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9m3 0h.01M3 3l18 18"
      />
    </svg>
  );
}

function TestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}