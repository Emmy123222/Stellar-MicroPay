/**
 * components/RecurringPayments.tsx
 * Client-side recurring payment schedules (#612). Schedules live in
 * localStorage; "Pay Now" hands the details to the dashboard's send form.
 */

import { useCallback, useEffect, useState } from "react";

export interface RecurringPayment {
  id: string;
  destination: string;
  amount: string;
  memo: string;
  interval: "daily" | "weekly" | "monthly";
  nextRunAt: number;
  createdAt: number;
}

const STORAGE_KEY = "stellar-micropay:recurring-payments";

const INTERVAL_MS: Record<RecurringPayment["interval"], number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

function loadSchedules(): RecurringPayment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecurringPayment[]) : [];
  } catch {
    return [];
  }
}

function saveSchedules(schedules: RecurringPayment[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

function isDue(schedule: RecurringPayment): boolean {
  return Date.now() >= schedule.nextRunAt;
}

function describeInterval(interval: RecurringPayment["interval"]): string {
  return interval.charAt(0).toUpperCase() + interval.slice(1);
}

export default function RecurringPayments({
  onPayNow,
}: {
  onPayNow: (data: { destination: string; amount: string; memo: string }) => void;
}) {
  const [schedules, setSchedules] = useState<RecurringPayment[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [interval, setInterval] = useState<RecurringPayment["interval"]>("monthly");

  useEffect(() => {
    setSchedules(loadSchedules());
  }, []);

  const persist = useCallback((next: RecurringPayment[]) => {
    setSchedules(next);
    saveSchedules(next);
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim() || !amount.trim() || Number.isNaN(parseFloat(amount))) return;

    const now = Date.now();
    const schedule: RecurringPayment = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      destination: destination.trim(),
      amount: amount.trim(),
      memo: memo.trim(),
      interval,
      nextRunAt: now + INTERVAL_MS[interval],
      createdAt: now,
    };
    persist([schedule, ...schedules]);
    setDestination("");
    setAmount("");
    setMemo("");
    setInterval("monthly");
    setIsFormOpen(false);
  };

  const handleDelete = (id: string) => {
    persist(schedules.filter((schedule) => schedule.id !== id));
  };

  const handlePayNow = (schedule: RecurringPayment) => {
    onPayNow({
      destination: schedule.destination,
      amount: schedule.amount,
      memo: schedule.memo,
    });
  };

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-white">Recurring Payments</h2>
        <button
          type="button"
          onClick={() => setIsFormOpen((open) => !open)}
          className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
        >
          {isFormOpen ? "Cancel" : "+ New"}
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleCreate} className="space-y-3 mb-4">
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Recipient address (G…)"
            className="input-field font-mono text-sm"
            required
          />
          <div className="flex gap-2">
            <input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (XLM)"
              className="input-field text-sm flex-1"
              required
            />
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as RecurringPayment["interval"])}
              className="input-field text-sm w-28"
              aria-label="Interval"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Memo (optional)"
            className="input-field text-sm"
            maxLength={28}
          />
          <button type="submit" className="btn-primary w-full text-sm">
            Save schedule
          </button>
        </form>
      )}

      {schedules.length === 0 ? (
        <p className="text-sm text-slate-400">
          No recurring payments yet. Create a schedule to send XLM automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((schedule) => {
            const due = isDue(schedule);
            return (
              <li
                key={schedule.id}
                className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200">
                      {schedule.amount} XLM · {describeInterval(schedule.interval)}
                      {due && (
                        <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                          Due
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-xs text-slate-500">{schedule.destination}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePayNow(schedule)}
                      className="rounded-lg bg-stellar-500/20 px-2.5 py-1 text-xs font-semibold text-stellar-300 hover:bg-stellar-500/30 transition-colors cursor-pointer"
                    >
                      Pay Now
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(schedule.id)}
                      aria-label="Delete schedule"
                      className="px-1.5 text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
