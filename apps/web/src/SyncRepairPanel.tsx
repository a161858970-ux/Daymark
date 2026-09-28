import { useEffect, useState } from "react";
import type { ActionRequiredSyncIssue } from "@course-manager/application";
import type { Course } from "@course-manager/domain";
import { AttentionSummary } from "./AttentionSummary.js";

const reasons: Record<string, string> = {
  VALIDATION_ERROR: "这次修改未通过同步校验。请检查本机内容后重新提交。",
  IDEMPOTENCY_REPLAY:
    "这次提交与先前使用的提交标识不一致。可以用新的提交标识重交当前内容。",
  NOT_FOUND: "已同步端找不到对应记录。请检查本机内容，或明确采用已同步状态。",
  FORBIDDEN:
    "这项操作已经不再允许，例如删除撤销期限已经结束。可以明确采用已同步状态。",
};

function objectType(issue: ActionRequiredSyncIssue): string {
  const labels: Record<string, string> = {
    ITEM: "事项",
    COURSE_INFORMATION: "课程信息",
    RAW_CAPTURE: "原始记录",
    COURSE: "课程",
    SEMESTER: "学期",
    COURSE_SCHEDULE_COLLECTION: "课程安排",
    SEMESTER_WEEK_COLLECTION: "学期周设置",
    ITEM_ASSOCIATION: "事项关联",
    COURSE_SCHEDULE: "课程安排",
    SEMESTER_WEEK: "学期周设置",
  };
  return labels[issue.mutation.entity_type] ?? "记录";
}

function userFacingReason(issue: ActionRequiredSyncIssue): string {
  if (issue.mutation.last_error?.includes("Legacy collection change"))
    return "这项整组设置来自旧版本，系统无法安全确认它的完整上下文。请查看相关设置后重新保存，或明确采用已同步状态。";
  return reasons[issue.error_code] ?? "这条记录需要检查后才能继续同步。";
}

function objectName(issue: ActionRequiredSyncIssue, courses: Course[]): string {
  const value = issue.local_object;
  if (issue.mutation.entity_type === "COURSE_SCHEDULE_COLLECTION")
    return (
      courses.find((course) => course.id === issue.mutation.entity_id)?.name ??
      "课程安排"
    );
  const name = value?.title ?? value?.content ?? value?.name ?? value?.raw_text;
  return typeof name === "string" && name.trim() ? name : objectType(issue);
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
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("未能处理这条记录。请检查记录内容或稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`conflict-choice sync-repair-choice ${busy ? "resolving" : ""}`}
    >
      <p className="eyebrow">{objectType(issue)}</p>
      <h3>{objectName(issue, courses)}</h3>
      <p>{userFacingReason(issue)}</p>
      <div className="sync-repair-actions">
        <button type="button" disabled={busy} onClick={() => onInspect(issue)}>
          查看记录
        </button>
        {issue.can_retry && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onRetry(issue.mutation.mutation_id))}
          >
            {busy ? "正在处理…" : "重新提交当前内容"}
          </button>
        )}
        {issue.can_abandon && !confirmAbandon && (
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => setConfirmAbandon(true)}
          >
            采用已同步状态
          </button>
        )}
      </div>
      {confirmAbandon && (
        <div className="sync-repair-confirm">
          <p>
            本次本机修改将被明确放弃；系统随后重新读取已同步内容。原始记录不会被静默删除。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => onAbandon(issue.mutation.mutation_id))
            }
          >
            确认采用已同步状态
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => setConfirmAbandon(false)}
          >
            取消
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
  const [expanded, setExpanded] = useState(defaultExpanded || openSignal > 0);
  useEffect(() => {
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);
  if (!issues.length) return null;
  return (
    <section
      className={`attention-panel sync-repair-panel ${expanded ? "expanded" : ""}`}
      aria-label="需要检查的同步记录"
    >
      <AttentionSummary
        eyebrow="SYNC RECOVERY"
        title="有记录需要检查"
        description="本机内容仍然保留。"
        count={issues.length}
        expanded={expanded}
        tone="repair"
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="attention-body">
          <p className="attention-intro">
            查看当前记录后重新提交，或明确采用已经同步的状态。
          </p>
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
