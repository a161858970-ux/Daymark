import { authClient } from "./authSync.js";

/** Which weekday a week begins on (0 = Sunday … 6 = Saturday). */
export const WEEK_START_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
] as const;

const LOCAL_KEY = "cm.week_start_weekday";
const METADATA_KEY = "week_start_weekday";
const DEFAULT_WEEK_START = 1;

export function weekStartLabel(value: number): string {
  return (
    WEEK_START_OPTIONS.find((option) => option.value === value)?.label ?? "周一"
  );
}

function normalize(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
    ? value
    : null;
}

export function readLocalWeekStart(): number {
  try {
    const stored = normalize(Number(window.localStorage.getItem(LOCAL_KEY)));
    if (stored !== null) return stored;
  } catch {
    /* no storage available */
  }
  return DEFAULT_WEEK_START;
}

export function writeLocalWeekStart(value: number): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, String(value));
  } catch {
    /* no storage available */
  }
}

/**
 * Signed-in users read the account value first so two devices agree; the
 * local copy covers signed-out use and the moment before the session loads.
 */
export async function loadWeekStart(): Promise<number> {
  if (authClient) {
    try {
      const { data } = await authClient.auth.getSession();
      const stored = normalize(
        data.session?.user?.user_metadata?.[METADATA_KEY],
      );
      if (stored !== null) {
        writeLocalWeekStart(stored);
        return stored;
      }
    } catch {
      /* fall back to the local preference */
    }
  }
  return readLocalWeekStart();
}

/**
 * Local first (the picker must react immediately), then the account so the
 * choice follows the user to other devices. A failed account write stays
 * local; changing the value again retries it.
 */
export async function saveWeekStart(value: number): Promise<void> {
  writeLocalWeekStart(value);
  if (!authClient) return;
  try {
    await authClient.auth.updateUser({ data: { [METADATA_KEY]: value } });
  } catch {
    /* offline / signed out: the local preference still applies */
  }
}
