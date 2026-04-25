import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import TipWidget from "@/components/TipWidget";

interface TipPageProps {
  publicKey: string | null;
  onConnect: (publicKey: string) => void;
}

interface ResolvedAccount {
  username: string;
  publicKey: string;
}

type ResolveState =
  | { status: "loading"; message?: string }
  | { status: "ready"; account: ResolvedAccount }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string };

export default function TipPage({ publicKey, onConnect }: TipPageProps) {
  const router = useRouter();
  const routeUsername = useMemo(() => {
    const raw = router.query.username;
    return typeof raw === "string" ? raw : null;
  }, [router.query.username]);

  const [resolveState, setResolveState] = useState<ResolveState>({ status: "loading" });

  useEffect(() => {
    if (!router.isReady) return;

    if (!routeUsername) {
      setResolveState({
        status: "not-found",
        message: "We could not figure out which creator tip page you were trying to open.",
      });
      return;
    }

    let isActive = true;
    const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

    setResolveState({
      status: "loading",
      message: `Looking up @${routeUsername}...`,
    });

    fetch(`${apiBase}/api/accounts/resolve/${encodeURIComponent(routeUsername)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);

        if (response.status === 404) {
          throw new ResolveError(
            "not-found",
            payload?.error || `@${routeUsername} does not have a public tip page yet.`
          );
        }

        if (!response.ok) {
          throw new ResolveError(
            "error",
            payload?.error || "We could not load this tip page right now."
          );
        }

        const account = payload?.data;
        if (!payload?.success || !account?.publicKey || !account?.username) {
          throw new ResolveError("error", "The tip page response was incomplete.");
        }

        return {
          username: account.username,
          publicKey: account.publicKey,
        } satisfies ResolvedAccount;
      })
      .then((account) => {
        if (!isActive) return;
        setResolveState({ status: "ready", account });
      })
      .catch((error: unknown) => {
        if (!isActive) return;

        if (error instanceof ResolveError) {
          setResolveState({ status: error.kind, message: error.message });
          return;
        }

        setResolveState({
          status: "error",
          message: "Something went wrong while loading this creator. Please try again.",
        });
      });

    return () => {
      isActive = false;
    };
  }, [routeUsername, router.isReady]);

  const pageTitle =
    resolveState.status === "ready"
      ? `Tip @${resolveState.account.username} | Stellar MicroPay`
      : routeUsername
        ? `Tip @${routeUsername} | Stellar MicroPay`
        : "Tip Creator | Stellar MicroPay";

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>

      <div className="relative min-h-[calc(100vh-88px)] overflow-hidden px-4 py-10 sm:px-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-stellar-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[320px] w-[320px] rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          {resolveState.status === "loading" && (
            <LoadingState message={resolveState.message || "Loading tip page..."} />
          )}

          {resolveState.status === "not-found" && (
            <FriendlyErrorState
              title="Creator not found"
              message={resolveState.message}
              accent="amber"
            />
          )}

          {resolveState.status === "error" && (
            <FriendlyErrorState
              title="Tip page unavailable"
              message={resolveState.message}
              accent="red"
            />
          )}

          {resolveState.status === "ready" && (
            <TipWidget
              creatorUsername={resolveState.account.username}
              destination={resolveState.account.publicKey}
              publicKey={publicKey}
              onConnect={onConnect}
            />
          )}
        </div>
      </div>
    </>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-cosmos-900/70 p-8 shadow-2xl shadow-stellar-950/20">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="h-3 w-28 rounded-full bg-white/10 animate-pulse" />
          <div className="mt-4 h-10 w-48 rounded-full bg-white/10 animate-pulse" />
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full rounded-full bg-white/10 animate-pulse" />
            <div className="h-4 w-5/6 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="h-6 w-36 rounded-full bg-white/10 animate-pulse" />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 rounded-2xl bg-white/10 animate-pulse" />
            ))}
          </div>
          <div className="mt-6 h-12 rounded-2xl bg-white/10 animate-pulse" />
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-400">{message}</p>
    </div>
  );
}

function FriendlyErrorState({
  title,
  message,
  accent,
}: {
  title: string;
  message: string;
  accent: "amber" | "red";
}) {
  const accentClasses =
    accent === "amber"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
      : "border-red-500/20 bg-red-500/10 text-red-200";

  return (
    <div className="mx-auto max-w-2xl rounded-[32px] border border-white/10 bg-cosmos-900/70 p-8 text-center shadow-2xl shadow-stellar-950/20">
      <div className={["mx-auto flex h-20 w-20 items-center justify-center rounded-full border", accentClasses].join(" ")}>
        <PlanetIcon className="h-10 w-10" />
      </div>

      <h1 className="mt-6 font-display text-4xl font-bold text-white">{title}</h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-slate-300">{message}</p>

      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link href="/" className="btn-primary px-8 py-3">
          Back to home
        </Link>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="btn-secondary px-8 py-3"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

class ResolveError extends Error {
  kind: "not-found" | "error";

  constructor(kind: "not-found" | "error", message: string) {
    super(message);
    this.kind = kind;
  }
}

function PlanetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a8 8 0 100-16 8 8 0 000 16zm0 0c3.4 0 6.7-1.1 9.4-3.2.4-.3.4-.9 0-1.2-2.7-2.1-6-3.2-9.4-3.2s-6.7 1.1-9.4 3.2c-.4.3-.4.9 0 1.2C5.3 19.9 8.6 21 12 21zm0-16c2.9 0 5.7-.8 8.2-2.2.5-.3.6-.9.2-1.3-.9-.9-2.1-1.5-3.4-1.5H7c-1.3 0-2.5.6-3.4 1.5-.4.4-.3 1 .2 1.3C6.3 4.2 9.1 5 12 5z"
      />
    </svg>
  );
}
