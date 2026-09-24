/**
 * components/LiveEventsFeed.tsx
 * Real-time feed of Soroban contract events for the dashboard "Live Events" tab.
 *
 * Consumes `GET /api/events/stream` (server-sent events). Every message is a
 * JSON envelope tagged with `kind`:
 *
 *   { kind: "ready",  contractId, network, configured, message }
 *   { kind: "event",  event: { id, type, participants, amount, ledger, ... } }
 *   { kind: "status", level, message }
 *
 * New events are prepended so they slide in at the top, and the connection is
 * re-established automatically with exponential backoff whenever it drops.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatAsset, shortenAddress, timeAgo } from "@/utils/format";

/** A normalised contract event as delivered by the backend. */
export interface ContractEvent {
  id: string;
  type: string;
  participants: string[];
  topicLabels?: string[];
  amount: string | null;
  asset: string | null;
  ledger: number;
  closedAt: string | null;
  contractId: string | null;
  transactionHash: string | null;
}

type StreamEnvelope =
  | {
      kind: "ready";
      contractId: string | null;
      network: string;
      configured: boolean;
      message: string | null;
    }
  | { kind: "event"; event: ContractEvent }
  | { kind: "status"; level?: string; message: string };

export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unsupported";

export interface LiveEventsFeedProps {
  /** Override for `NEXT_PUBLIC_API_URL`. */
  apiBaseUrl?: string;
  /** Maximum events kept in the list (newest first). Defaults to 50. */
  maxEvents?: number;
  className?: string;
}

const DEFAULT_MAX_EVENTS = 50;
const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** Badge styling per event type; unknown types fall back to a neutral badge. */
const EVENT_TYPE_STYLES: Record<string, string> = {
  open: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  claim: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  top_up: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  close: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  tip: "bg-stellar-500/15 text-stellar-300 border-stellar-500/30",
  receipt: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  refund: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  open: "Open",
  claim: "Claim",
  top_up: "Top up",
  close: "Close",
  tip: "Tip",
  receipt: "Receipt",
  refund: "Refund",
};

export function resolveApiBaseUrl(override?: string): string {
  if (override) return override.replace(/\/$/, "");
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

export function buildEventsStreamUrl(apiBaseUrl: string): string {
  return `${resolveApiBaseUrl(apiBaseUrl)}/api/events/stream`;
}

/** Prepend `incoming`, ignoring duplicates and trimming to `maxEvents`. */
export function mergeEvent(
  existing: ContractEvent[],
  incoming: ContractEvent,
  maxEvents: number
): ContractEvent[] {
  if (!incoming?.id || existing.some((event) => event.id === incoming.id)) {
    return existing;
  }
  return [incoming, ...existing].slice(0, maxEvents);
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…` : hash;
}

function describeParticipants(event: ContractEvent): string {
  const [from, to] = event.participants;

  if (from && to) return `${shortenAddress(from, 6)} → ${shortenAddress(to, 6)}`;
  if (from) return shortenAddress(from, 6);
  if (event.topicLabels?.length) return event.topicLabels.join(" · ");
  return "—";
}

function StatusDot({ state }: { state: ConnectionState }) {
  const colour =
    state === "live"
      ? "bg-emerald-400"
      : state === "unsupported"
      ? "bg-slate-500"
      : "bg-amber-400 animate-pulse";

  return <span className={`w-2 h-2 rounded-full ${colour}`} aria-hidden="true" />;
}

function statusLabel(state: ConnectionState): string {
  switch (state) {
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting…";
    case "unsupported":
      return "Streaming not supported in this browser";
    default:
      return "Connecting…";
  }
}

export default function LiveEventsFeed({
  apiBaseUrl,
  maxEvents = DEFAULT_MAX_EVENTS,
  className = "",
}: LiveEventsFeedProps) {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  // Keep the latest cap available to the stream handler without tearing down
  // the connection every time the prop changes.
  const maxEventsRef = useRef(maxEvents);
  useEffect(() => {
    maxEventsRef.current = maxEvents;
  }, [maxEvents]);

  const streamUrl = useMemo(() => buildEventsStreamUrl(apiBaseUrl ?? ""), [apiBaseUrl]);

  useEffect(() => {
    const EventSourceCtor =
      typeof window !== "undefined" ? window.EventSource : undefined;

    if (!EventSourceCtor) {
      setState("unsupported");
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let connectedOnce = false;

    const scheduleReconnect = () => {
      if (disposed) return;

      try {
        source?.close();
      } catch {
        // ignore close failures
      }
      source = null;

      attempt += 1;
      setState("reconnecting");

      const delay = Math.min(
        INITIAL_RETRY_MS * 2 ** (attempt - 1),
        MAX_RETRY_MS
      );
      retryTimer = setTimeout(connect, delay);
    };

    const handleMessage = (message: MessageEvent<string>) => {
      let payload: StreamEnvelope;

      try {
        payload = JSON.parse(message.data) as StreamEnvelope;
      } catch {
        return;
      }

      if (payload.kind === "event" && payload.event) {
        setEvents((current) =>
          mergeEvent(current, payload.event, maxEventsRef.current)
        );
        setState("live");
        setLastUpdatedAt(new Date());
        return;
      }

      if (payload.kind === "ready") {
        setNetwork(payload.network);
        setNotice(payload.configured ? null : payload.message ?? null);
        return;
      }

      if (payload.kind === "status") {
        setNotice(payload.message);
      }
    };

    function connect() {
      if (disposed) return;

      setState(connectedOnce ? "reconnecting" : "connecting");

      source = new EventSourceCtor!(streamUrl);

      source.onopen = () => {
        attempt = 0;
        connectedOnce = true;
        setNotice(null);
        setState("live");
      };

      source.onmessage = handleMessage;

      source.onerror = () => {
        if (!source) return;

        // While the browser is still retrying the same connection we only
        // surface the state; once it gives up we take over with backoff.
        if (source.readyState === EventSourceCtor!.CLOSED) {
          scheduleReconnect();
        } else {
          setState("reconnecting");
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        source?.close();
      } catch {
        // ignore close failures
      }
    };
  }, [streamUrl, restartKey]);

  const handleReconnect = useCallback(() => {
    setNotice(null);
    setRestartKey((key) => key + 1);
  }, []);

  return (
    <section
      className={`card bg-cosmos-800/50 border-stellar-500/20 ${className}`}
      aria-labelledby="live-events-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2
            id="live-events-heading"
            className="font-display text-lg font-semibold text-white"
          >
            Live Events
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Soroban contract activity streamed from the events API
            {network ? ` · ${network}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-2 text-xs text-slate-400"
            role="status"
            aria-live="polite"
          >
            <StatusDot state={state} />
            {statusLabel(state)}
          </span>
          <button
            type="button"
            onClick={handleReconnect}
            className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
          >
            Reconnect
          </button>
        </div>
      </div>

      {notice && (
        <p
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          role="status"
        >
          {notice}
        </p>
      )}

      {state === "connecting" && events.length === 0 && (
        <p className="text-sm text-slate-500" role="status" aria-busy="true">
          Connecting to the event stream…
        </p>
      )}

      {state === "unsupported" && (
        <p className="text-sm text-slate-500">
          This browser does not support server-sent events, so the live feed is
          unavailable.
        </p>
      )}

      {state !== "connecting" && events.length === 0 && state !== "unsupported" && (
        <p className="text-sm text-slate-500">
          Waiting for the first contract event…
        </p>
      )}

      {events.length > 0 && (
        <ul className="space-y-2" aria-live="polite" aria-relevant="additions">
          {events.map((event) => (
            <li
              key={event.id}
              className="animate-slide-in flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm"
            >
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                  EVENT_TYPE_STYLES[event.type] ??
                  "bg-white/5 text-slate-300 border-white/10"
                }`}
              >
                {eventTypeLabel(event.type)}
              </span>

              <span className="font-mono text-xs text-slate-300">
                {describeParticipants(event)}
              </span>

              <span className="text-xs text-slate-200">
                {event.amount
                  ? formatAsset(event.amount, event.asset ?? "XLM")
                  : "—"}
              </span>

              <span className="text-xs text-slate-500">
                Ledger #{event.ledger.toLocaleString("en-US")}
              </span>

              <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                {event.transactionHash && (
                  <span className="font-mono" title={event.transactionHash}>
                    {truncateHash(event.transactionHash)}
                  </span>
                )}
                <span>{event.closedAt ? timeAgo(event.closedAt) : "—"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {lastUpdatedAt && (
        <p className="mt-3 text-[11px] text-slate-600">
          Last event received {lastUpdatedAt.toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}
