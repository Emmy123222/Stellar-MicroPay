import { useEffect, useState } from "react";
import { formatXLM } from "@/utils/format";

export const CURRENT_RECURRING_SCHEMA_VERSION = 2;

export interface RecurringScheduleV1 {
  id: string;
  recipient: string;
  amount: string;
  memo: string;
  frequency: "weekly" | "monthly";
  startDate: string;
  nextDueDate: string;
  createdAt: number;
  paused?: boolean;
  pausedAt?: number;
}

export interface RecurringScheduleV2 {
  schemaVersion: 2;
  id: string;
  recipient: string;
  amount: string;
  memo: string;
  frequency: "weekly" | "monthly";
  startDate: string;
  nextDueDate: string;
  createdAt: number;
  paused: boolean;
  pausedAt: number | null;
}

const STORAGE_KEY = "stellar-micropay:recurring-schedules";

function getActiveNetworkName(): string {
  if (typeof window === "undefined") return "testnet";

  try {
    const stored = window.localStorage.getItem("stellar-micropay:network");
    if (!stored) return "testnet";
    const parsed = JSON.parse(stored) as { network?: string };
    return parsed?.network === "mainnet" ? "mainnet" : "testnet";
  } catch {
    return "testnet";
  }
}

function getActivePublicKey(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem("stellar-micropay:last-public-key");
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function getSchedulesStorageKey(publicKey: string | null = getActivePublicKey(), networkName: string = getActiveNetworkName()): string {
  const key = (publicKey ?? "anonymous").trim() || "anonymous";
  return `${RECURRING_SCHEDULES_STORAGE_KEY}:${networkName}:${key}`;
}

function migrateLegacySchedules(): RecurringSchedule[] {
  if (typeof window === "undefined") return [];

  const key = getSchedulesStorageKey();
  const current = readSchedulesFromKey(key);
  if (current.length > 0) return current;

  const legacy = readSchedulesFromKey(RECURRING_SCHEDULES_STORAGE_KEY);
  if (legacy.length === 0) return [];

  try {
    localStorage.setItem(key, JSON.stringify(legacy));
    localStorage.removeItem(RECURRING_SCHEDULES_STORAGE_KEY);
  } catch {
    // ignore
  }

  return legacy;
}

function readSchedulesFromKey(key: string): RecurringSchedule[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function loadSchedules(): RecurringSchedule[] {
  const key = getSchedulesStorageKey();
  const current = readSchedulesFromKey(key);
  return current.length > 0 ? current : migrateLegacySchedules();
}

function saveSchedules(schedules: RecurringSchedule[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

// Serialize a Date to a YYYY-MM-DD string using its *local* components.
// Avoids the UTC shift that .toISOString() introduces for users ahead of UTC.
function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeNextDueDate(from: string, frequency: "weekly" | "monthly"): string {
  const [y, m, day] = from.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7);
  } else {
    // Add a month, clamping to the last valid day so Jan 31 -> Feb 28/29
    // instead of rolling over into March.
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDayOfMonth));
  }
  return toISODate(d);
}

function todayISO(): string {
  return toISODate(new Date());
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isDue(schedule: RecurringSchedule): boolean {
  // Paused schedules are never due
  if (schedule.paused) return false;
  return schedule.nextDueDate <= todayISO();
}

interface RecurringPaymentsProps {
  onPayNow: (prefill: { destination: string; amount: string; memo: string }) => void;
}

interface FormState {
  recipient: string;
  amount: string;
  memo: string;
  frequency: "weekly" | "monthly";
  startDate: string;
}

const EMPTY_FORM: FormState = {
  recipient: "",
  amount: "",
  memo: "",
  frequency: "monthly",
  startDate: todayISO(),
};

export default function RecurringPayments({ onPayNow }: RecurringPaymentsProps) {
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const announce = React.useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  useEffect(() => {
    setSchedules(loadSchedules());
  }, []);

  const announce = (message: string) => {
    setAnnouncement(message);
  };

  const persist = (updated: RecurringSchedule[]) => {
    setSchedules(updated);
    saveSchedules(updated);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = () => {
    if (!form.recipient.trim()) {
      setFormError("Recipient is required.");
      return;
    }
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      setFormError("Enter a valid amount greater than 0.");
      return;
    }
    if (form.frequency !== "weekly" && form.frequency !== "monthly") {
      setFormError("Select a valid frequency cadence.");
      return;
    }
    if (!form.startDate) {
      setFormError("Start date is required.");
      return;
    }

    if (editingId) {
      const updated = schedules.map((s) =>
        s.id === editingId
          ? {
              ...s,
              recipient: form.recipient.trim(),
              amount: form.amount,
              memo: form.memo.trim(),
              frequency: form.frequency,
              startDate: form.startDate,
              // If the schedule is still on its first cycle (never paid), keep
              // the next-due date pinned to the start date. Otherwise preserve
              // the already-advanced cycle position.
              nextDueDate: s.nextDueDate === s.startDate ? form.startDate : s.nextDueDate,
            }
          : s
      );
      persist(updated);
    } else {
      const newSchedule: RecurringSchedule = {
        schemaVersion: CURRENT_RECURRING_SCHEMA_VERSION,
        id: generateId(),
        recipient: form.recipient.trim(),
        amount: form.amount,
        memo: form.memo.trim(),
        frequency: form.frequency,
        startDate: form.startDate,
        nextDueDate: form.startDate,
        createdAt: Date.now(),
        paused: false,
        pausedAt: null,
      };
      persist([...schedules, newSchedule]);
    }
    resetForm();
  };

  const handleEdit = (s: RecurringSchedule) => {
    setForm({
      recipient: s.recipient,
      amount: s.amount,
      memo: s.memo,
      frequency: s.frequency,
      startDate: s.startDate,
    });
    setEditingId(s.id);
    setFormError(null);
    setShowForm(true);
  };

  const handlePause = (id: string) => {
    const now = Date.now();
    const updated = schedules.map((s) =>
      s.id === id ? { ...s, paused: true, pausedAt: Date.now() } : s
    );
    persist(updated);
  };

  const handleResume = (id: string) => {
    const updated = schedules.map((s) =>
      s.id === id ? { ...s, paused: false, pausedAt: undefined } : s
    );
    persist(updated);
  };

  const handleDelete = (id: string) => {
    persist(schedules.filter((s) => s.id !== id));
  };

  const handlePayNow = (s: RecurringSchedule) => {
    if (s.paused) return;

    // Advance the next due date after triggering pay
    const updated = schedules.map((sc) =>
      sc.id === s.id ? { ...sc, nextDueDate: computeNextDueDate(sc.nextDueDate, sc.frequency) } : sc
    );
    persist(updated);
    onPayNow({ destination: s.recipient, amount: s.amount, memo: s.memo });
  };

  const dueSchedules = schedules.filter(isDue);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-stellar-400" />
          Recurring Payment Schedules
        </h2>
        {!showForm && (
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
              setShowForm(true);
            }}
            className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
          >
            + New schedule
          </button>
        )}
      </div>

      {dueSchedules.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-stellar-500/10 border border-stellar-500/20">
          <p className="text-xs font-semibold text-stellar-300 uppercase tracking-wider mb-3">
            Due Today ({dueSchedules.length})
          </p>
          <div className="space-y-3">
            {dueSchedules.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-slate-900/60 p-3 rounded-lg border border-slate-800"
              >
                <div>
                  <p className="text-sm text-white font-medium">
                    {formatXLM(s.amount)} to <span className="font-mono">{s.recipient.slice(0, 8)}...</span>
                  </p>
                  <p className="text-xs text-slate-400">Due: {s.nextDueDate} ({s.frequency})</p>
                </div>
                <button
                  onClick={() => handlePayNow(s)}
                  className="bg-stellar-500 hover:bg-stellar-600 text-white text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="mb-6 p-4 rounded-xl bg-slate-900/80 border border-slate-700 animate-slide-up">
          <h3 className="text-sm font-semibold text-white mb-4">
            {editingId ? "Edit recurring payment" : "New recurring payment"}
          </h3>
          {formError && (
            <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded">
              {formError}
            </p>
          )}
          <div className="space-y-3">
            <div>
              <label className="label">Recipient Address</label>
              <input
                type="text"
                className="input-field text-sm"
                placeholder="G..."
                value={form.recipient}
                onChange={(e) => setForm({ ...form, recipient: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Amount (XLM)</label>
                <input
                  type="number"
                  step="any"
                  className="input-field text-sm"
                  placeholder="0.0000000"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Frequency</label>
                <select
                  className="input-field text-sm"
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as "weekly" | "monthly" })}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Start Date</label>
              <input
                type="date"
                className="input-field text-sm"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Memo (Optional)</label>
              <input
                type="text"
                className="input-field text-sm"
                placeholder="Optional memo"
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={resetForm}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="btn-primary text-xs px-3 py-1.5"
              >
                {editingId ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">No recurring schedules yet.</p>
          <p className="text-xs text-slate-500 mt-1">Create a schedule to automate regular XLM transfers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className={`p-4 rounded-xl border flex items-center justify-between transition-colors ${
                s.paused
                  ? "bg-slate-900/40 border-slate-800 opacity-75"
                  : "bg-slate-900/70 border-slate-800"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-semibold text-sm text-white">{formatXLM(s.amount)}</span>
                  <span className="text-xs text-slate-400 capitalize">{s.frequency}</span>
                  {s.paused && <span className="text-xs text-amber-400 font-medium">· Paused</span>}
                  {s.memo && (
                    <span className="text-xs text-slate-500 truncate max-w-[120px]">
                      · {s.memo}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-400 truncate">
                  To: {s.recipient}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Next: <span className="text-slate-300">{formatDate(s.nextDueDate)}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {s.paused ? (
                  <button
                    onClick={() => handleResume(s.id)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                    title="Resume schedule"
                    aria-label="Resume schedule"
                  >
                    <PlayIcon className="w-4 h-4 text-emerald-400" />
                  </button>
                ) : (
                  <button
                    onClick={() => handlePause(s.id)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                    title="Pause schedule"
                    aria-label="Pause schedule"
                  >
                    <PauseIcon className="w-4 h-4 text-amber-400" />
                  </button>
                )}
                <button
                  onClick={() => handleEdit(s)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                  title="Edit schedule"
                  aria-label="Edit schedule"
                >
                  <EditIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                  title="Delete schedule"
                  aria-label="Delete schedule"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Icons
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
