/**
 * contexts/ThemeContext.tsx
 * Theme context with manual toggle and optional auto dark-mode scheduling.
 *
 * Schedule settings persisted to localStorage under the keys:
 *   stellar-micropay:theme          – "dark" | "light"
 *   stellar-micropay:theme-auto     – "1" when auto schedule is enabled
 *   stellar-micropay:theme-night-start  – e.g. "20:00"
 *   stellar-micropay:theme-night-end    – e.g. "07:00"
 *
 * Behaviour:
 *   • When auto schedule is OFF, toggleTheme works exactly as before.
 *   • When auto schedule is ON, the effective theme is derived from the
 *     current local time vs. the configured night window on every minute tick
 *     and whenever the window settings change.
 *   • toggleTheme (manual override) temporarily overrides the schedule for
 *     the remainder of the browser session (does NOT persist theme key so
 *     the schedule resumes on next page load).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const LS_THEME = "stellar-micropay:theme";
const LS_AUTO = "stellar-micropay:theme-auto";
const LS_NIGHT_START = "stellar-micropay:theme-night-start";
const LS_NIGHT_END = "stellar-micropay:theme-night-end";

export const DEFAULT_NIGHT_START = "20:00";
export const DEFAULT_NIGHT_END = "07:00";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert "HH:MM" to total minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Returns true when the current local time falls within [start, end) night window.
 *  Correctly handles overnight windows (e.g. 20:00 – 07:00). */
export function isInNightWindow(nowMinutes: number, startHHMM: string, endHHMM: string): boolean {
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);

  if (start === end) return false; // degenerate – treat as always-day

  if (start < end) {
    // Same-day window, e.g. 22:00 – 23:00
    return nowMinutes >= start && nowMinutes < end;
  } else {
    // Overnight window, e.g. 20:00 – 07:00
    return nowMinutes >= start || nowMinutes < end;
  }
}

function currentLocalMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function applyThemeToDOM(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}

// ─── Context types ───────────────────────────────────────────────────────────

export interface ThemeSchedule {
  /** Whether the auto schedule is active */
  autoEnabled: boolean;
  /** Night-mode start time, "HH:MM" (24-hour) */
  nightStart: string;
  /** Night-mode end time, "HH:MM" (24-hour) */
  nightEnd: string;
}

export interface ThemeContextType {
  theme: "dark" | "light";
  /** Manual toggle – overrides the schedule for the current session */
  toggleTheme: () => void;
  schedule: ThemeSchedule;
  /** Update any subset of schedule settings */
  setSchedule: (patch: Partial<ThemeSchedule>) => void;
}

// ─── Context ────────────────────────────────────────────────────────────────

export const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  schedule: {
    autoEnabled: false,
    nightStart: DEFAULT_NIGHT_START,
    nightEnd: DEFAULT_NIGHT_END,
  },
  setSchedule: () => {},
});

export const useTheme = () => useContext(ThemeContext);

// ─── Provider ────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [schedule, setScheduleState] = useState<ThemeSchedule>({
    autoEnabled: false,
    nightStart: DEFAULT_NIGHT_START,
    nightEnd: DEFAULT_NIGHT_END,
  });

  // Track whether the user has manually overridden this session
  const manualOverrideRef = useRef<"dark" | "light" | null>(null);

  // ── Compute the schedule-driven theme ──────────────────────────────────────
  const computeScheduledTheme = useCallback(
    (sched: ThemeSchedule): "dark" | "light" => {
      if (!sched.autoEnabled) return theme; // no-op when disabled
      return isInNightWindow(currentLocalMinutes(), sched.nightStart, sched.nightEnd)
        ? "dark"
        : "light";
    },
    [theme]
  );

  // ── Initialise from localStorage (client-only) ────────────────────────────
  useEffect(() => {
    const savedTheme = localStorage.getItem(LS_THEME) as "dark" | "light" | null;
    const autoEnabled = localStorage.getItem(LS_AUTO) === "1";
    const nightStart = localStorage.getItem(LS_NIGHT_START) ?? DEFAULT_NIGHT_START;
    const nightEnd = localStorage.getItem(LS_NIGHT_END) ?? DEFAULT_NIGHT_END;

    const initSchedule: ThemeSchedule = { autoEnabled, nightStart, nightEnd };
    setScheduleState(initSchedule);

    let effective: "dark" | "light";
    if (autoEnabled) {
      effective = isInNightWindow(currentLocalMinutes(), nightStart, nightEnd) ? "dark" : "light";
    } else {
      effective =
        savedTheme ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }

    setTheme(effective);
    applyThemeToDOM(effective === "dark");
  }, []);

  // ── Periodic tick – re-evaluate schedule every minute ─────────────────────
  useEffect(() => {
    if (!schedule.autoEnabled) return;

    const tick = () => {
      // Respect manual session override
      if (manualOverrideRef.current !== null) return;

      const next = isInNightWindow(currentLocalMinutes(), schedule.nightStart, schedule.nightEnd)
        ? "dark"
        : "light";

      setTheme((prev) => {
        if (prev !== next) {
          applyThemeToDOM(next === "dark");
        }
        return next;
      });
    };

    tick(); // run immediately on mount / schedule change
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [schedule]);

  // ── Manual toggle ──────────────────────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyThemeToDOM(next === "dark");

    if (schedule.autoEnabled) {
      // Session-only override: don't persist theme key so schedule resumes next load
      manualOverrideRef.current = next;
    } else {
      localStorage.setItem(LS_THEME, next);
    }
  }, [theme, schedule.autoEnabled]);

  // ── Schedule updater ───────────────────────────────────────────────────────
  const setSchedule = useCallback(
    (patch: Partial<ThemeSchedule>) => {
      setScheduleState((prev) => {
        const next = { ...prev, ...patch };

        // Persist
        localStorage.setItem(LS_AUTO, next.autoEnabled ? "1" : "0");
        localStorage.setItem(LS_NIGHT_START, next.nightStart);
        localStorage.setItem(LS_NIGHT_END, next.nightEnd);

        // When enabling auto, clear any session override and immediately
        // apply the schedule-driven theme
        if (next.autoEnabled) {
          manualOverrideRef.current = null;
          const scheduled = isInNightWindow(currentLocalMinutes(), next.nightStart, next.nightEnd)
            ? "dark"
            : "light";
          setTheme(scheduled);
          applyThemeToDOM(scheduled === "dark");
        }

        // When disabling auto, persist the current visible theme
        if (!next.autoEnabled && prev.autoEnabled) {
          localStorage.setItem(LS_THEME, theme);
        }

        return next;
      });
    },
    [theme]
  );

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, schedule, setSchedule }}>
      {children}
    </ThemeContext.Provider>
  );
}
