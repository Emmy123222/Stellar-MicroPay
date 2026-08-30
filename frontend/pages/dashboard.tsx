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

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import dynamic from "next/dynamic";
import Head from "next/head";
import FloatingAssistantButton from "../components/FloatingAssistantButton";
import { useTranslation } from "@/lib/i18n";

// Dynamic imports for large components to improve initial load (Lighthouse Performance)
const PaymentLinkGenerator = dynamic(() => import("../components/PaymentLinkGenerator"), { ssr: false });
const WalletConnect = dynamic(() => import("../components/WalletConnect"), { ssr: false });
const SendPaymentForm = dynamic(() => import("../components/SendPaymentForm"), { ssr: false });
const TransactionList = dynamic(() => import("../components/TransactionList"), { ssr: false });
const MultiSigFlow = dynamic(() => import("../components/MultiSigFlow"), {
  ssr: false,
  loading: () => (
    <div className="card mb-6 bg-cosmos-950/80 border-white/10">
      <div className="flex items-center gap-3 py-8 justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-stellar-400 border-t-transparent" />
        <span className="text-sm text-slate-400">Loading multi-sig…</span>
      </div>
    </div>
  ),
});
const OnboardingTour = dynamic(() => import("../components/OnboardingTour"), { ssr: false });
const BatchPaymentForm = dynamic(() => import("../components/BatchPaymentForm"), { ssr: false });
const QRCodeModal = dynamic(() => import("../components/QRCodeModal"), { ssr: false });
const CreatorTipsDashboard = dynamic(() => import("../components/CreatorTipsDashboard"), { ssr: false });
const RecurringPayments = dynamic(() => import("../components/RecurringPayments"), { ssr: false });

// The assistant panel (and its dependencies) should not ship in the initial
// bundle — it's only ever needed after the user opens the floating button,
// so it's loaded on demand with a visible loading state (#610).
const AIPaymentAssistantLoading = () => {
  const { t } = useTranslation("dashboard");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5 shadow-2xl">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-stellar-400 border-t-transparent" />
        <span className="text-sm text-slate-300">{t("loading_ai")}</span>
      </div>
    </div>
  );
};

const AIPaymentAssistant = dynamic(() => import("../components/AIPaymentAssistant"), {
  ssr: false,
  loading: AIPaymentAssistantLoading,
});

import {
  DraggableWidget,
  BubbleNotification,
  PaymentStatsWidget,
  MonthlySpendingChart,
  ThirtyDayVolumeChart,
  TopRecipientsWidget,
  BalanceSparkline,
  PaymentStats,
} from "@/components/dashboard";
import PaymentRequestGenerator from "@/pages/PaymentRequestGenerator";

import {
  getXLMBalance,
  getAccountReserveInfo,
  type AccountReserveInfo,
  getBalances,
  type WalletBalance,
  getFriendBotFunding,
  waitForAccountFunding,
  ACCOUNT_NOT_FOUND_ERROR,
  getRecentPaymentsForStats,
  getRecentPaymentsForSparkline,
  fetchAllPayments,
  PaymentRecord,
} from "@/lib/stellar";
import { formatAsset, formatUSD, copyToClipboard, exportToCSV, shortenAddress } from "@/utils/format";
import { useToastContext } from "@/lib/ToastContext";
import { getJwtToken } from "@/lib/auth";
import { URIParseResult, uriToPrefillData } from "@/lib/sep0007";
import { useWallet } from "@/lib/useWallet";
import { useOnboarding } from "@/hooks/useOnboarding";

interface DashboardProps {
  stellarURI?: URIParseResult | null;
}

interface CachedBalanceSnapshot {
  xlmBalance: string;
  usdcBalance: string | null;
  reserveInfo: AccountReserveInfo | null;
  savedAt: number;
}

const BALANCE_CACHE_KEY_PREFIX = "stellar-micropay:offline-balance:";

function getBalanceCacheKey(publicKey: string) {
  return `${BALANCE_CACHE_KEY_PREFIX}${publicKey}`;
}

function loadBalanceSnapshot(publicKey: string): CachedBalanceSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getBalanceCacheKey(publicKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBalanceSnapshot;
    if (!parsed?.xlmBalance || typeof parsed.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveBalanceSnapshot(
  publicKey: string,
  snapshot: Omit<CachedBalanceSnapshot, "savedAt">
) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getBalanceCacheKey(publicKey),
    JSON.stringify({ ...snapshot, savedAt: Date.now() })
  );
}

function formatSnapshotTime(savedAt: number) {
  return new Date(savedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Dashboard widget drag-to-reorder (#622) ────────────────────────────────

const DASHBOARD_WIDGET_IDS = ["stats", "monthlySpending", "thirtyDayVolume", "analytics"] as const;
type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
const WIDGET_ORDER_STORAGE_KEY = "stellar-micropay:dashboard-widget-order";

function loadWidgetOrder(): DashboardWidgetId[] {
  if (typeof window === "undefined") return [...DASHBOARD_WIDGET_IDS];

  try {
    const raw = window.localStorage.getItem(WIDGET_ORDER_STORAGE_KEY);
    if (!raw) return [...DASHBOARD_WIDGET_IDS];
    const parsed = JSON.parse(raw);
    const isValidOrder =
      Array.isArray(parsed) &&
      parsed.length === DASHBOARD_WIDGET_IDS.length &&
      DASHBOARD_WIDGET_IDS.every((id) => parsed.includes(id));
    return isValidOrder ? (parsed as DashboardWidgetId[]) : [...DASHBOARD_WIDGET_IDS];
  } catch {
    return [...DASHBOARD_WIDGET_IDS];
  }
}

function saveWidgetOrder(order: DashboardWidgetId[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WIDGET_ORDER_STORAGE_KEY, JSON.stringify(order));
}

export default function Dashboard({ stellarURI }: DashboardProps) {
  const { t } = useTranslation("dashboard");
  const { publicKey } = useWallet();
  const AUTO_REFRESH_SECONDS = 30;
  // Move focus to the dashboard heading once a wallet is connected, so keyboard
  // and screen-reader focus follows the content instead of staying on the
  // now-hidden Connect control (#252).
  const dashboardHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (publicKey) {
      dashboardHeadingRef.current?.focus();
    }
  }, [publicKey]);
  const [xlmBalance, setXlmBalance]   = useState<string | null>(null);
  const [reserveInfo, setReserveInfo] = useState<AccountReserveInfo | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [otherBalances, setOtherBalances] = useState<Array<{ code: string; issuer: string; balance: string }>>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [staleBalanceAt, setStaleBalanceAt] = useState<number | null>(null);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [addressExpanded, setAddressExpanded] = useState(false);
  const [balanceFlash, setBalanceFlash] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshCountdown, setRefreshCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const { addToast } = useToastContext();
  const showToast = (msg: string) => addToast(msg, "info");
  const [showQRModal, setShowQRModal] = useState(false);
  const { showTour: showOnboardingTour, completeTour: handleTourComplete, skipTour: handleTourSkip } =
    useOnboarding(!!publicKey);

  // Dashboard widget order — draggable and persisted across sessions (#622)
  const [widgetOrder, setWidgetOrder] = useState<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<DashboardWidgetId | null>(null);

  useEffect(() => {
    setWidgetOrder(loadWidgetOrder());
  }, []);

  const handleWidgetDragStart = useCallback(
    (id: DashboardWidgetId) => (e: React.DragEvent) => {
      setDraggedWidgetId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    []
  );

  const handleWidgetDragOver = useCallback(
    (id: DashboardWidgetId) => (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedWidgetId && draggedWidgetId !== id) {
        setDragOverWidgetId(id);
      }
    },
    [draggedWidgetId]
  );

  const handleWidgetDragLeave = useCallback((id: DashboardWidgetId) => {
    setDragOverWidgetId((current) => (current === id ? null : current));
  }, []);

  const handleWidgetDrop = useCallback(
    (id: DashboardWidgetId) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverWidgetId(null);
      const sourceId = draggedWidgetId;
      setDraggedWidgetId(null);
      if (!sourceId || sourceId === id) return;

      setWidgetOrder((current) => {
        const next = current.filter((widgetId) => widgetId !== sourceId);
        const targetIndex = next.indexOf(id);
        next.splice(targetIndex, 0, sourceId);
        saveWidgetOrder(next);
        return next;
      });
    },
    [draggedWidgetId]
  );

  const handleWidgetDragEnd = useCallback(() => {
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  }, []);

  const isTestnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet";
  const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [accountNotFound, setAccountNotFound] = useState(false);

  const router = useRouter();
  const [activePaymentTab, setActivePaymentTab] = useState<"single" | "batch">("single");

  // Build prefill object from query parameters.
  // Supports legacy ?prefillDestination= (contacts page) and
  // new ?to=&amount= (Send Again from transaction history).
  const { prefillDestination, to, amount: queryAmount } = router.query;
  const prefill =
    prefillDestination
      ? { destination: prefillDestination as string, amount: "", memo: "" }
      : to
      ? {
          destination: to as string,
          amount: typeof queryAmount === "string" ? queryAmount : "",
          memo: "",
          fromHistory: true,
        }
      : null;
  const [friendbotLoading, setFriendbotLoading] = useState(false);
  const [friendbotSuccessMessage, setFriendbotSuccessMessage] = useState<string | null>(null);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [paymentStatsLoading, setPaymentStatsLoading] = useState(false);
  const [paymentStatsError, setPaymentStatsError] = useState<string | null>(null);
  const [incomingPayment, setIncomingPayment] = useState<PaymentRecord | null>(null);
  const [showExternalBanner, setShowExternalBanner] = useState(true);

  // AI Payment Assistant state
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  // Tracks whether the assistant panel has ever been opened — gates mounting
  // the dynamically-imported panel so its chunk isn't fetched until then (#610).
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  const [aiPrefillData, setAiPrefillData] = useState<{
    destination: string;
    amount: string;
    memo?: string;
  } | null>(null);

  const handleOpenAIAssistant = () => {
    setAssistantLoaded(true);
    setShowAIAssistant(true);
  };

  const handleAIAssistantConfirm = (intent: { amount: string; recipient: string; memo: string }) => {
    setAiPrefillData({
      destination: intent.recipient,
      amount: intent.amount,
      memo: intent.memo,
    });
    setActivePaymentTab("single");
  };

  // Recurring payments prefill — set when user clicks "Pay Now" on a due schedule
  const [recurringPrefill, setRecurringPrefill] = useState<{
    destination: string;
    amount: string;
    memo: string;
  } | null>(null);

  const handleRecurringPayNow = (data: { destination: string; amount: string; memo: string }) => {
    setRecurringPrefill(data);
    setActivePaymentTab("single");
  };

  // Creator username for tips dashboard
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);

  // Stats and charts state
  const [spendingData, setSpendingData] = useState<any[]>([]);
  const [spendingLoading, setSpendingLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<any | null>(null);
  const [sparklineData, setSparklineData] = useState<any[]>([]);
  const [sparklineLoading, setSparklineLoading] = useState(false);

  // Analytics state
  const [thirtyDayData, setThirtyDayData] = useState<any[]>([]);
  const [thirtyDayLoading, setThirtyDayLoading] = useState(false);
  const [topRecipients, setTopRecipients] = useState<Array<{ address: string; totalXLMSent: string }>>([]);
  const [topRecipientsLoading, setTopRecipientsLoading] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);

  // Notification state
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleMessage, setBubbleMessage] = useState("");
  const realtimeSourceRef = useRef<EventSource | null>(null);
  const realtimePollRef = useRef<number | null>(null);
  const latestPaymentIdRef = useRef<string | null>(null);


  // Fetch username for connected wallet
  const fetchUsername = useCallback(async () => {
    if (!publicKey) return;
    
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
    try {
      const response = await fetch(
        `${apiBase}/api/accounts/resolve/${encodeURIComponent(publicKey)}`
      );
      if (response.ok) {
        const payload = await response.json();
        if (payload?.success && payload?.data?.username) {
          setCreatorUsername(payload.data.username);
        }
      }
    } catch (err) {
      console.error("Error fetching username:", err);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchUsername();
  }, [fetchUsername]);

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;

    setBalanceLoading(true);
    setAccountNotFound(false);

    try {
      const [allBalances, reserve] = await Promise.all([
        getBalances(publicKey),
        getAccountReserveInfo(publicKey),
      ]);
      const xlm = allBalances.find((b) => b.assetCode === "XLM");
      const usdc = allBalances.find((b) => b.assetCode === "USDC");
      const others = allBalances
        .filter((b) => b.assetCode !== "XLM" && b.assetCode !== "USDC")
        .map((b) => {
          const [, issuer] = b.asset.split(":");
          return { code: b.assetCode, issuer: issuer ?? "", balance: b.balance };
        });

      const bal = xlm?.balance ?? "0";
      const usdcBal = usdc?.balance ?? null;

      setXlmBalance((prev) => {
        if (prev !== null && prev !== bal) {
          setBalanceFlash(true);
          setTimeout(() => setBalanceFlash(false), 800);
        }
        return bal;
      });
      setUsdcBalance(usdcBal);
      setOtherBalances(others);
      setReserveInfo(reserve);
      setStaleBalanceAt(null);
      saveBalanceSnapshot(publicKey, {
        xlmBalance: bal,
        usdcBalance: usdcBal,
        reserveInfo: reserve,
      });
    } catch (err: unknown) {
      const cached = loadBalanceSnapshot(publicKey);
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      if (cached && isOffline) {
        setXlmBalance(cached.xlmBalance);
        setUsdcBalance(cached.usdcBalance);
        setReserveInfo(cached.reserveInfo);
        setStaleBalanceAt(cached.savedAt);
        return;
      }

      const msg = err instanceof Error ? err.message : "";
      if (
        msg === ACCOUNT_NOT_FOUND_ERROR ||
        msg.includes("404") ||
        msg.toLowerCase().includes("not found")
      ) {
        setAccountNotFound(true);
      }
      setXlmBalance(null);
      setUsdcBalance(null);
      setOtherBalances([]);
      setReserveInfo(null);
      setStaleBalanceAt(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [publicKey]);

  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    setIsRefreshingBalance(true);
    setRefreshCountdown(AUTO_REFRESH_SECONDS);
    try {
      await fetchBalance();
    } finally {
      setIsRefreshingBalance(false);
    }
  }, [publicKey, fetchBalance]);

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

      const [resStats, resSummary] = await Promise.all([
        fetch(`${apiBase}/api/payments/${encodeURIComponent(publicKey)}/stats`, { headers }),
        fetch(`${apiBase}/api/analytics/${encodeURIComponent(publicKey)}/summary`, { headers })
      ]);

      if (!resStats.ok) {
        throw new Error("Unable to load payment stats right now.");
      }

      const payloadStats = await resStats.json();
      const dataStats = payloadStats?.data;

      let comparisonData;
      if (resSummary.ok) {
        const payloadSummary = await resSummary.json();
        comparisonData = payloadSummary?.data?.comparison;
      }

      if (
        !payloadStats?.success ||
        !dataStats ||
        typeof dataStats.totalSentXLM !== "string" ||
        typeof dataStats.totalReceivedXLM !== "string" ||
        typeof dataStats.totalTransactions !== "number"
      ) {
        throw new Error("Payment stats response was invalid.");
      }

      setPaymentStats({
        publicKey: dataStats.publicKey,
        totalSentXLM: dataStats.totalSentXLM,
        totalReceivedXLM: dataStats.totalReceivedXLM,
        sentCount: Number(dataStats.sentCount ?? 0),
        receivedCount: Number(dataStats.receivedCount ?? 0),
        totalTransactions: dataStats.totalTransactions,
        comparison: comparisonData,
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
      const months: any[] = [];
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

      payments.forEach((p: any) => {
        const pDate = new Date(p.createdAt);
        const m = months.find(
          (m: any) =>
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

  const fetchSparklineData = useCallback(async () => {
    if (!publicKey) return;
    setSparklineLoading(true);
    try {
      const history = await getRecentPaymentsForSparkline(publicKey, 10);
      setSparklineData(history.map(h => parseFloat(h.amount)));
    } catch (err) {
      console.error("Failed to fetch sparkline data:", err);
    } finally {
      setSparklineLoading(false);
    }
  }, [publicKey]);


  useEffect(() => {
    fetchSpendingHistory();
  }, [fetchSpendingHistory, refreshKey]);

  const fetchThirtyDayVolume = useCallback(async () => {
    if (!publicKey) return;
    setThirtyDayLoading(true);
    try {
      const payments = await getRecentPaymentsForStats(publicKey, 200);
      const now = new Date();
      const days: any[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        days.push({
          day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          dateKey: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
          sent: 0,
          received: 0,
        });
      }
      payments.forEach((p: PaymentRecord) => {
        const pd = new Date(p.createdAt);
        const key = `${pd.getFullYear()}-${pd.getMonth()}-${pd.getDate()}`;
        const entry = days.find((d: any) => d.dateKey === key);
        if (entry) {
          const amt = parseFloat(p.amount);
          if (p.type === "sent") entry.sent += amt;
          else entry.received += amt;
        }
      });
      setThirtyDayData(days);
    } catch (err) {
      console.error("Failed to fetch 30-day volume:", err);
    } finally {
      setThirtyDayLoading(false);
    }
  }, [publicKey]);

  const fetchTopRecipients = useCallback(async () => {
    if (!publicKey) return;
    setTopRecipientsLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const headers: HeadersInit = {};
      const token = getJwtToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${apiBase}/api/analytics/${encodeURIComponent(publicKey)}/top-recipients`,
        { headers }
      );
      if (res.ok) {
        const payload = await res.json();
        setTopRecipients(payload?.data?.topRecipients ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch top recipients:", err);
    } finally {
      setTopRecipientsLoading(false);
    }
  }, [publicKey]);

  const handleExportCSV = async () => {
    if (!publicKey || csvExporting) return;
    setCsvExporting(true);
    try {
      const records = await fetchAllPayments(publicKey);
      exportToCSV(records);
    } catch {
      showToast("Failed to export CSV. Please try again.");
    } finally {
      setCsvExporting(false);
    }
  };

  useEffect(() => {
    fetchThirtyDayVolume();
  }, [fetchThirtyDayVolume, refreshKey]);

  useEffect(() => {
    fetchTopRecipients();
  }, [fetchTopRecipients, refreshKey]);

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
    if (!publicKey) return;

    const intervalId = window.setInterval(() => {
      setRefreshCountdown((current) => {
        if (current <= 1) {
          void refreshBalance();
          return AUTO_REFRESH_SECONDS;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [publicKey, refreshBalance]);

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
    if (ok) showToast(t("address_copied"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualRefresh = () => {
    setRefreshCountdown(30);
    fetchBalance();
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
    if (!publicKey) {
      return false;
    }

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
      showToast(t("notifications_disabled"));
      return;
    }

    // --- Enable ---
    if (!('Notification' in window)) {
      showToast('This browser does not support notifications.');
      return;
    }

    if (Notification.permission === 'denied') {
      showToast(t("notifications_blocked"));
      return;
    }

    try {
      const subscribed = await subscribeToPush();
      if (!subscribed) return;

      localStorage.setItem('notificationOptIn', 'true');
      setNotificationEnabled(true);
      showToast(t("notifications_enabled"));

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

    let cancelled = false;
    let eventSource: EventSource | null = null;

    const connect = async () => {
      await primeRealtimeCursor();
      if (cancelled) return;

      stopPollingFallback();

      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const streamUrl = `${apiBase}/api/analytics/${encodeURIComponent(publicKey)}/stream`;

      if (typeof window === "undefined" || !("EventSource" in window)) {
        startPollingFallback();
        return;
      }

      eventSource = new EventSource(streamUrl);
      realtimeSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const payment = JSON.parse(event.data) as PaymentRecord;
          void handleRealtimePayment(payment);
        } catch (error) {
          console.error("Failed to parse realtime payment event:", error);
        }
      };

      eventSource.onerror = () => {
        if (cancelled) return;

        console.warn("Realtime payment stream disconnected; falling back to polling.");
        eventSource?.close();
        realtimeSourceRef.current = null;
        startPollingFallback();
      };

      eventSource.onopen = () => {
        stopPollingFallback();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      stopPollingFallback();
      realtimeSourceRef.current?.close();
      realtimeSourceRef.current = null;
      eventSource?.close();
    };
  }, [handleRealtimePayment, primeRealtimeCursor, publicKey, startPollingFallback, stopPollingFallback]);

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">{t("title")}</h1>
          <p className="text-slate-400">{t("connect_wallet_msg")}</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      <Head>
        <title>Dashboard | Stellar-MicroPay</title>
        <meta name="description" content="Manage your Stellar account, view balances, and send micropayments instantly. Real-time transaction history and wallet summary." />
        <link rel="canonical" href="https://stellar-micropay.vercel.app/dashboard" />
      </Head>
      <div className="mb-8">
        {/* Focus target after wallet connect / navigation so focus lands on the
            dashboard content instead of a now-hidden control (#252). */}
        <h1
          ref={dashboardHeadingRef}
          tabIndex={-1}
          className="font-display text-3xl font-bold text-white mb-1 outline-none"
        >
          {t("title")}
        </h1>
        <p className="text-slate-400 text-sm">{t("subtitle")}</p>
        <div className="mt-4">
          <button
            onClick={handleToggleNotifications}
            disabled={notificationPermission === 'denied'}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-stellar-400 hover:text-stellar-300 disabled:bg-white/5 disabled:text-slate-400 disabled:border-white/5 disabled:cursor-not-allowed transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {notificationEnabled
                ? t("disable_notifications")
                : notificationPermission === 'denied'
                ? t("notifications_blocked")
                : t("enable_notifications")}
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
              <TestIcon className="w-3.5 h-3.5" /> {t("test_notification")}
            </button>
          )}
        </div>
      </div>

      {(() => {
        const widgetContent: Record<DashboardWidgetId, { label: string; node: React.ReactNode }> = {
          stats: {
            label: "Payment stats",
            node: (
              <PaymentStatsWidget
                stats={paymentStats}
                loading={paymentStatsLoading}
                error={paymentStatsError}
                onRetry={fetchPaymentStats}
              />
            ),
          },
          monthlySpending: {
            label: "Monthly spending chart",
            node: (
              <>
                <MonthlySpendingChart
                  data={spendingData}
                  loading={spendingLoading}
                  onBarClick={setSelectedMonth}
                />

                {selectedMonth && (
                  <div className="mb-8 p-4 rounded-xl bg-stellar-500/5 border border-stellar-500/10 flex items-center justify-between animate-fade-in">
                    <div>
                      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
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
                      aria-label="Close month details"
                      className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                    >
                      <CloseIcon className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </>
            ),
          },
          thirtyDayVolume: {
            label: "30-day volume chart",
            node: <ThirtyDayVolumeChart data={thirtyDayData} loading={thirtyDayLoading} />,
          },
          analytics: {
            label: "Top recipients and export",
            node: (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <TopRecipientsWidget recipients={topRecipients} loading={topRecipientsLoading} />
                <div className="card flex flex-col justify-between">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-white mb-2">Export Payment History</h2>
                    <p className="text-sm text-slate-400">Download your full transaction history as a CSV file.</p>
                  </div>
                  <button
                    onClick={handleExportCSV}
                    disabled={csvExporting}
                    className="mt-4 btn-secondary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {csvExporting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-stellar-400 border-t-transparent rounded-full animate-spin" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <DownloadIcon className="w-4 h-4" />
                        Export CSV
                      </>
                    )}
                  </button>
                </div>
              </div>
            ),
          },
        };

        return widgetOrder.map((id) => (
          <DraggableWidget
            key={id}
            id={id}
            dragHandleLabel={widgetContent[id].label}
            isDragging={draggedWidgetId === id}
            isDragOver={dragOverWidgetId === id}
            onDragStart={handleWidgetDragStart(id)}
            onDragOver={handleWidgetDragOver(id)}
            onDragLeave={() => handleWidgetDragLeave(id)}
            onDrop={handleWidgetDrop(id)}
            onDragEnd={handleWidgetDragEnd}
          >
            {widgetContent[id].node}
          </DraggableWidget>
        ));
      })()}

      <div className="card mb-8 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-stellar-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-stellar-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label mb-1">{t("wallet_address")}</p>
            <button
              onClick={() => setAddressExpanded((x) => !x)}
              className="font-mono text-sm text-slate-300 select-text cursor-pointer hover:text-white transition-colors text-start break-all"
              title={addressExpanded ? "Click to collapse" : "Click to show full address"}
            >
              {addressExpanded
                ? publicKey
                : `${publicKey.slice(0, 6)}…${publicKey.slice(-6)}`}
            </button>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={handleCopyAddress}
                className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? (
                  <>
                    <CheckIcon className="w-3.5 h-3.5" /> {t("copied_address")}
                  </>
                ) : (
                  <>
                    <CopyIcon className="w-3.5 h-3.5" /> {t("copy_address")}
                  </>
                )}
              </button>
              <span className="text-slate-600 text-xs">·</span>
              <button
                onClick={() => setAddressExpanded((x) => !x)}
                className="text-xs text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {addressExpanded ? t("collapse") : t("show_full")}
              </button>
            </div>
          </div>

          <div className="sm:text-end flex-shrink-0">
            <p className="label mb-1">XLM Balance</p>
            {balanceLoading ? (
              <div className="h-8 w-36 bg-white/10 rounded-lg animate-pulse" />
            ) : xlmBalance !== null ? (
              <div>
                <div className={`font-display text-3xl font-bold text-white ${balanceFlash ? "balance-flash" : ""}`}>
                  {parseFloat(xlmBalance).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-stellar-400 text-xl ms-2">XLM</span>
                </div>
                {xlmPrice !== null && (
                  <p className="text-sm text-slate-400 mt-0.5">
                    {formatUSD(parseFloat(xlmBalance) * xlmPrice)}
                  </p>
                )}
                {staleBalanceAt && (
                  <p className="mt-1 inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                    {t("offline_snapshot", { time: formatSnapshotTime(staleBalanceAt) })}
                  </p>
                )}
                {!sparklineLoading && sparklineData.length > 0 && (
                  <div className="mt-3">
                    <BalanceSparkline data={sparklineData} />
                  </div>
                )}
                <button
                  onClick={() => void refreshBalance()}
                  className="mt-1 text-xs text-slate-400 hover:text-stellar-400 transition-colors flex items-center gap-1 sm:justify-end cursor-pointer"
                  disabled={balanceLoading}
                >
                  <RefreshIcon className={`w-3 h-3 ${isRefreshingBalance ? "animate-spin" : ""}`} />
                  {isRefreshingBalance ? "Refreshing..." : "Refresh"}
                </button>
                <p className="mt-1 text-[11px] text-slate-400 sm:text-end">
                  Refreshing in {refreshCountdown}s
                </p>
              </div>
            ) : accountNotFound && isTestnet ? (
              <div className="sm:text-end">
                <p className="text-amber-400 text-sm mb-2">Account not funded yet</p>
                <p className="text-xs text-slate-400">
                  Use the funding card below to credit your wallet on testnet.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-slate-400 text-sm">Failed to load</p>
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

      {/* Reserve warning (#164). Amber when balance is within 2 XLM of the
          minimum reserve, red when at or below it. Suppressed when the
          account isn't funded — the Friendbot card below covers that path. */}
      {!accountNotFound && reserveInfo && (() => {
        const { xlmBalance: bal, minimumBalance: min, subentryCount } = reserveInfo;
        const atOrBelow = bal <= min;
        const nearMin = bal > min && bal <= min + 2;
        if (!atOrBelow && !nearMin) return null;
        const tone = atOrBelow
          ? "border-red-500/40 bg-red-500/5 text-red-200"
          : "border-amber-500/40 bg-amber-500/5 text-amber-200";
        const headline = atOrBelow
          ? "XLM balance is at or below the minimum reserve"
          : "XLM balance is close to the minimum reserve";
        return (
          <div
            className={`card mb-6 ${tone}`}
            role="alert"
            aria-live="polite"
            data-testid="reserve-warning"
          >
            <p className="font-semibold mb-1">{headline}</p>
            <p className="text-sm opacity-90">
              You hold <strong>{bal.toFixed(4)} XLM</strong>. Your account
              must keep at least{" "}
              <strong>{min.toFixed(4)} XLM</strong> reserved
              ({subentryCount} subentries × 0.5 XLM + 2 XLM base). Top up
              before submitting transactions to avoid{" "}
              <code className="text-xs opacity-80">tx_insufficient_balance</code>.
            </p>
            <p className="text-sm mt-2">
              <a
                href="https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#base-reserves"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-100 opacity-80"
              >
                Stellar base reserves docs →
              </a>
            </p>
          </div>
        );
      })()}

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
                {formatAsset(usdcBalance, "USDC")}
              </div>
            </div>
          </div>
        </div>
      )}

      {otherBalances.map((b) => (
        <div key={b.code} className="card mb-4 bg-gradient-to-br from-cosmos-800 to-cosmos-900 border-violet-500/20 relative overflow-hidden">
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="label mb-1">{b.code} Balance</p>
              <div className="font-display text-3xl font-bold text-white">
                {formatAsset(b.balance, b.code)}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Creator Tips Dashboard */}
      <CreatorTipsDashboard 
        publicKey={publicKey} 
        username={creatorUsername}
        xlmPrice={xlmPrice}
      />

      {/* External payment banner */}
      {stellarURI && stellarURI.success && stellarURI.isExternal && showExternalBanner && (
        <ExternalPaymentBanner
          message={stellarURI.data?.msg}
          originDomain={stellarURI.data?.originDomain}
          onDismiss={() => setShowExternalBanner(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 order-1 lg:order-none">
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
              accountBalances={otherBalances}
              onSuccess={handlePaymentSuccess}
              prefill={
                aiPrefillData
                  ? aiPrefillData
                  : recurringPrefill
                  ? recurringPrefill
                  : stellarURI && stellarURI.success
                  ? uriToPrefillData(stellarURI.data!)
                  : null
              }
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
          <RecurringPayments onPayNow={handleRecurringPayNow} />
          <PaymentRequestGenerator />
          <div className="mt-6">
            <MultiSigFlow
              publicKey={publicKey}
              xlmBalance={xlmBalance || "0"}
              onSuccess={handlePaymentSuccess}
            />
          </div>
        </div>

        <div className="lg:col-span-1 order-2 lg:order-none">
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

      <FloatingAssistantButton onClick={handleOpenAIAssistant} />
      {assistantLoaded && (
        <AIPaymentAssistant
          isOpen={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          onConfirm={handleAIAssistantConfirm}
        />
      )}
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
