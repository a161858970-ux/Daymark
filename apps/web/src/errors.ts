/**
 * User-facing error language.
 *
 * The domain and API layers throw precise engineering messages on purpose;
 * the UI must still speak product language, so every surface maps a failure
 * through here before showing it. Internal concepts (mutation, row_version,
 * cursor, outbox, SQL, provider status codes) never reach the user.
 *
 * Locale is resolved outside React via the stored UI preference
 * (`readStoredLocale`), which `I18nProvider.setLocale` keeps in sync.
 * Engineering messages stay English; the UI shows localized product copy.
 */
import { getMessage } from "./i18n/messages/index.js";
import { readStoredLocale } from "./i18n/locale.js";

const known: [RegExp, string][] = [
  [/记录内容不能为空|Record cannot be empty/i, "errors.emptyRecord"],
  [/Course context is unavailable/i, "errors.courseContextUnavailable"],
  [/Keeping one record requires an Item/i, "errors.needItem"],
  [/Raw capture has already been resolved/i, "errors.alreadyResolved"],
  [/Raw capture not found/i, "errors.notFoundRecord"],
  [/Course information cannot be empty/i, "errors.emptyCourseInformation"],
  [/Course information needs a course/i, "errors.courseInformationNeedsCourse"],
  [
    /Course not found|Item not found|Semester not found|not found/i,
    "errors.objectMissing",
  ],
  [/Split requires/i, "errors.splitNeedsTwo"],
  [/Account sync is not configured/i, "errors.syncNotConfigured"],
  // Domain-specific product nuances (kept under sync.* / errors.*).
  [/Offline: connect before importing/i, "sync.err.offlineImport"],
  [/Offline: note is saved locally/i, "sync.err.offlineCapture"],
  [/Local changes are not synced yet/i, "sync.err.localChangesPending"],
  [/AI unavailable; note saved locally/i, "sync.err.aiUnavailableSaved"],
  [/Course import is unavailable/i, "sync.err.importUnavailable"],
  [/Unsupported timetable file type/i, "sync.err.importBadType"],
  [/No installable update/i, "sync.noInstallableUpdate"],
  [
    /AI_UNAVAILABLE|Interpretation provider|智能整理暂时不可用/i,
    "errors.aiUnavailable",
  ],
  [/AI_INVALID_OUTPUT|无法可靠识别/i, "errors.aiInvalidOutput"],
  [/IMPORT_FAILED/i, "errors.importFailed"],
  // "Invalid import source" is a corrupt/misread payload, not a size
  // problem — mapping it to the size copy hid the real cause.
  [
    /Invalid import source|Cannot read the timetable file/i,
    "errors.importInvalidSource",
  ],
  [
    /Import source must be between 1 byte and 15 MB|15 MB|exceeds 15 MB/i,
    "errors.importTooLarge",
  ],
  [/AUTH_REQUIRED|Authentication required|401/i, "errors.authRequired"],
  [/RATE_LIMITED|rate limit/i, "errors.rateLimited"],
  [/VERSION_CONFLICT|row version|If-Match/i, "errors.versionConflict"],
  [
    /fetch failed|Failed to fetch|NetworkError|network request|ECONNREFUSED|offline|离线/i,
    "errors.network",
  ],
  [/timeout|timed out/i, "errors.timeout"],
  [/Permission|permission/i, "errors.permission"],
];

/**
 * Returns product language for a failure in the active UI locale. Chinese
 * messages (already product copy) pass through; anything unrecognised
 * becomes a safe fallback. `fallback` may be a literal product string or
 * omitted to use `errors.fallback`.
 */
export function toUserMessage(cause: unknown, fallback?: string): string {
  const locale = readStoredLocale();
  const fallbackMessage = fallback ?? getMessage(locale, "errors.fallback");
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : String(cause ?? "");
  const cleaned = raw.replace(/^Error:\s*/, "").trim();
  if (!cleaned) return fallbackMessage;
  if (/[一-鿿]/.test(cleaned)) return cleaned;
  for (const [pattern, key] of known)
    if (pattern.test(cleaned)) return getMessage(locale, key);
  return fallbackMessage;
}
