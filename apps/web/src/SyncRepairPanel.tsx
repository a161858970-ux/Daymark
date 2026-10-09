import { useEffect, useState } from "react";
import type { ActionRequiredSyncIssue } from "@daymark/application";
import type { Course } from "@daymark/domain";
import { AttentionSummary } from "./AttentionSummary.js";
import { useT, type Translate } from "./i18n/index.js";

function reasonKey(code: string): string {
  if (code === "VALIDATION_ERROR") return "sync.reason.validation";
  if (code === "IDEMPOTENCY_REPLAY") return "sync.reason.idempotency";
  if (code === "NOT_FOUND") return "sync.reason.notFound";
  if (code === "FORBIDDEN") return "sync.reason.forbidden";
  return "sync.genericReason";
}

function objectType(t: Translate, issue: ActionRequiredSyncIssue): string {
  const labels: Record<string, string> = {
    ITEM: "sync.entity.item",
    COURSE_INFORMATION: "sync.entity.courseInformation",
    RAW_CAPTURE: "sync.entity.rawCapture",
    COURSE: "sync.entity.course",
    SEMESTER: "sync.entity.semester",
    COURSE_SCHEDULE_COLLECTION: "sync.entity.courseSchedule",
    SEMESTER_WEEK_COLLECTION: "sync.entity.semesterWeeks",
    ITEM_ASSOCIATION: "sync.entity.itemAssociation",
    COURSE_SCHEDULE: "sync.entity.courseScheduleOne",
    SEMESTER_WEEK: "sync.entity.semesterWeekOne",
  };
  return t(labels[issue.mutation.entity_type] ?? "sync.objectFallback");
}

function userFacingReason(
  t: Translate,
  issue: ActionRequiredSyncIssue,
): string {
  if (issue.mutation.last_error?.includes("Legacy collection change"))
    return t("sync.legacyCollection");
  return t(reasonKey(issue.error_code));
}

function objectName(
  t: Translate,
  issue: ActionRequiredSyncIssue,
  courses: Course[],
): string {
  const value = issue.local_object;
  if (issue.mutation.entity_type === "COURSE_SCHEDULE_COLLECTION")
    return (
      courses.find((course) => course.id === issue.mutation.entity_id)?.name ??
      t("sync.entity.courseSchedule")
    );
  const name = value?.title ?? value?.content ?? value?.name ?? value?.raw_text;
  return typeof name === "string" && name.trim() ? name : objectType(t, issue);
}

function RepairIssue({
  issue,
  courses,
  onInspect,
  onRetry,
  onAbandon,
}: {
  issue: ActionRequiredSyncIssue;
  courses: Course[];
  onInspect: (issue: ActionRequiredSyncIssue) => void;
  onRetry: (mutationId: string) => Promise<void>;
  onAbandon: (mutationId: string) => Promise<void>;
}) {
  const t = useT();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("sync.actionFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`conflict-choice sync-repair-choice ${busy ? "resolving" : ""}`}
    >
      <p className="eyebrow">{objectType(t, issue)}</p>
      <h3>{objectName(t, issue, courses)}</h3>
      <p>{userFacingReason(t, issue)}</p>
      <div className="sync-repair-actions">
        <button type="button" disabled={busy} onClick={() => onInspect(issue)}>
          {t("sync.inspect")}
        </button>
        {issue.can_retry && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onRetry(issue.mutation.mutation_id))}
          >
            {busy ? t("common.processing") : t("sync.retrySubmit")}
          </button>
        )}
        {issue.can_abandon && !confirmAbandon && (
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => setConfirmAbandon(true)}
          >
            {t("sync.abandon")}
          </button>
        )}
      </div>
      {confirmAbandon && (
        <div className="sync-repair-confirm">
          <p>{t("sync.abandonNotice")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => onAbandon(issue.mutation.mutation_id))
            }
          >
            {t("sync.abandonConfirm")}
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => setConfirmAbandon(false)}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function SyncRepairPanel({
  issues,
  courses,
  onInspect,
  onRetry,
  onAbandon,
  defaultExpanded = false,
  openSignal = 0,
}: {
  issues: ActionRequiredSyncIssue[];
  courses: Course[];
  onInspect: (issue: ActionRequiredSyncIssue) => void;
  onRetry: (mutationId: string) => Promise<void>;
  onAbandon: (mutationId: string) => Promise<void>;
  defaultExpanded?: boolean;
  /** Bumped by the account panel's "查看并处理" so the exit opens itself. */
  openSignal?: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded || openSignal > 0);
  useEffect(() => {
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);
  if (!issues.length) return null;
  return (
    <section
      className={`attention-panel sync-repair-panel ${expanded ? "expanded" : ""}`}
      aria-label={t("sync.repairTitle")}
    >
      <AttentionSummary
        eyebrow={t("sync.repairEyebrow")}
        title={t("sync.repairHeading")}
        description={t("sync.repairDescription")}
        count={issues.length}
        expanded={expanded}
        tone="repair"
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="attention-body">
          <p className="attention-intro">{t("sync.repairIntro")}</p>
          {issues.map((issue) => (
            <RepairIssue
              key={issue.mutation.mutation_id}
              issue={issue}
              courses={courses}
              onInspect={onInspect}
              onRetry={onRetry}
              onAbandon={onAbandon}
            />
          ))}
        </div>
      )}
    </section>
  );
}
