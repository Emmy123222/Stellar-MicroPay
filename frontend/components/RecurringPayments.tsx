import { useEffect, useState } from "react";

export interface RecurringSchedule {
  id: string;
  recipient: string;
  amount: string;
  memo: string;
  frequency: "weekly" | "monthly";
  startDate: string; // ISO date string YYYY-MM-DD
  nextDueDate: string; // ISO date string YYYY-MM-DD
  createdAt: number;
}

const STORAGE_KEY = "stellar-micropay:recurring-schedules";

function loadSchedules(): RecurringSchedule[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
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

  useEffect(() => {
    setSchedules(loadSchedules());
  }, []);

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
      setFormError("Enter a valid amount.");
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
              nextDueDate:
                s.nextDueDate === s.startDate ? form.startDate : s.nextDueDate,
            }
          : s
      );
      persist(updated);
    } else {
      const newSchedule: RecurringSchedule = {
        id: generateId(),
        recipient: form.recipient.trim(),
        amount: form.amount,
        memo: form.memo.trim(),
        frequency: form.frequency,
        startDate: form.startDate,
        nextDueDate: form.startDate,
        createdAt: Date.now(),
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

  const handleDelete = (id: string) => {
    persist(schedules.filter((s) => s.id !== id));
  };

  const handlePayNow = (s: RecurringSchedule) => {
    // Advance the next due date after triggering pay
    const updated = schedules.map((sc) =>
      sc.id === s.id
        ? { ...sc, nextDueDate: computeNextDueDate(sc.nextDueDate, sc.frequency) }
        : sc
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
          Recurring Payments
        </h2>
        {!showForm && (
          <button
            onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowForm(true); }}
            className="text-xs text-stellar-400 hover:text-stellar-300 transition-colors cursor-pointer"
          >
            + New schedule
          </button>
        )}
      </div>

      {/* Due-today banner */}
      {dueSchedules.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">
            Due today — {dueSchedules.length} payment{dueSchedules.length > 1 ? "s" : ""}
          </p>
          <div className="space-y-2">
            {dueSchedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm text-slate-200">
                  <span className="font-mono text-xs text-slate-400 mr-1">
                    {s.recipient.slice(0, 6)}…{s.recipient.slice(-4)}
                  </span>
                  <span className="font-semibold text-white">{s.amount} XLM</span>
                  {s.memo && <span className="text-slate-400 text-xs ml-1">· {s.memo}</span>}
                </div>
                <button
                  onClick={() => handlePayNow(s)}
                  className="text-xs font-semibold bg-stellar-500/20 hover:bg-stellar-500/30 text-stellar-300 border border-stellar-500/30 rounded-lg px-3 py-1 transition-colors cursor-pointer"
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">
            {editingId ? "Edit schedule" : "New recurring payment"}
          </h3>

          <div>
            <label className="label text-xs mb-1">Recipient (Stellar address)</label>
            <input
              type="text"
              value={form.recipient}
              onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))}
              placeholder="G..."
              className="input-field font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs mb-1">Amount (XLM)</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.0000000"
                className="input-field"
                min="0"
              />
            </div>
            <div>
              <label className="label text-xs mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, frequency: e.target.value as "weekly" | "monthly" }))
                }
                className="input-field"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label text-xs mb-1">Memo (optional)</label>
            <input
              type="text"
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="Rent, Salary..."
              className="input-field"
            />
          </div>

          <div>
            <label className="label text-xs mb-1">Start date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="input-field"
            />
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={handleSubmit} className="btn-primary text-sm py-1.5 px-4">
              {editingId ? "Save" : "Create"}
            </button>
            <button
              onClick={resetForm}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {schedules.length === 0 && !showForm ? (
        <p className="text-sm text-slate-400">No recurring schedules yet.</p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-semibold text-sm text-white">{s.amount} XLM</span>
                  <span className="text-xs text-slate-400 capitalize">{s.frequency}</span>
                  {s.memo && (
                    <span className="text-xs text-slate-500 truncate max-w-[120px]">· {s.memo}</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-mono truncate">
                  {s.recipient.slice(0, 8)}…{s.recipient.slice(-6)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Next: <span className="text-slate-300">{formatDate(s.nextDueDate)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleEdit(s)}
                  className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                  aria-label="Edit schedule"
                >
                  <EditIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
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

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
