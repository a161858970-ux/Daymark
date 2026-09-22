import { useState } from "react";
import type { ConflictResolution } from "@course-manager/contracts";
import type { Course } from "@course-manager/domain";
import type { ConflictDetail } from "./syncTransport.js";

const fieldNames: Record<string, string> = {
  title: "标题",
  detail: "详情",
  course_id: "所属课程",
  start_at: "开始时间",
  occurrence_start_at: "发生时间",
  occurrence_end_at: "结束时间",
  due_at: "截止时间",
  reminder_level: "提醒方式",
  status: "完成状态",
  deleted_at: "删除状态",
  content: "课程信息",
  processing_status: "记录状态",
  unresolved_reason: "待确认原因",
};

function displayValue(
  field: string,
  value: unknown,
  courses: Course[],
): string {
  if (field === "deleted_at") return value ? "删除" : "保留";
  if (value === null || value === undefined || value === "") return "未填写";
  if (field === "course_id" && typeof value === "string")
    return courses.find((course) => course.id === value)?.name ?? "未知课程";
  const labels: Record<string, string> = {
    COMPLETE: "已完成",
    INCOMPLETE: "未完成",
    OFF: "关闭提醒",
    NORMAL: "一般提醒",
    HIGH: "较多提醒",
    RAW: "原始记录",
    PROCESSING: "处理中",
    RESOLVED: "已整理",
    UNRESOLVED: "待确认",
    DELETED: "已删除",
  };
  if (typeof value === "string" && value in labels) return labels[value]!;
  if (typeof value === "string" && field.endsWith("_at")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function ConflictChoice({
  detail,
  courses,
  onResolve,
}: {
  detail: ConflictDetail;
  courses: Course[];
  onResolve: (
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) => Promise<void>;
}) {
  const { conflict, current_entity: current } = detail;
  const [choices, setChoices] = useState<Record<string, "LOCAL" | "REMOTE">>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectName =
    conflict.entity_type === "ITEM"
      ? "事项"
      : conflict.entity_type === "COURSE_INFORMATION"
        ? "课程信息"
        : "原始记录";
  const name = String(
    current.title ?? current.content ?? current.raw_text ?? objectName,
  );
  const fields = conflict.conflicting_fields;
  async function submit() {
    if (fields.some((field) => !choices[field])) return;
    const values = Object.fromEntries(
      fields.map((field) => [field, choices[field]!]),
    );
    const selected = Object.values(values);
    const strategy = selected.every((value) => value === "LOCAL")
      ? "USE_LOCAL"
      : selected.every((value) => value === "REMOTE")
        ? "USE_REMOTE"
        : "USE_EXPLICIT_VALUE";
    setBusy(true);
    setError(null);
    try {
      await onResolve(conflict.id, Number(current.row_version), {
        strategy,
        field_resolutions: values,
      });
    } catch (cause) {
      setError(`未能保存选择：${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="conflict-choice">
      <p className="eyebrow">{objectName}</p>
      <h3>{current.deleted_at ? `已删除 · ${name}` : name}</h3>
      {Boolean(current.deleted_at) && (
        <p>这条记录已在另一设备删除。确认后会保留删除状态。</p>
      )}
      {fields.map((field) => (
        <fieldset key={field} className="conflict-field">
          <legend>{fieldNames[field] ?? field}</legend>
          <label>
            <input
              type="radio"
              name={`${conflict.id}:${field}`}
              checked={choices[field] === "LOCAL"}
              disabled={Boolean(current.deleted_at)}
              onChange={() => setChoices({ ...choices, [field]: "LOCAL" })}
            />
            <span>本机记录</span>
            <strong>
              {displayValue(field, conflict.local_version[field], courses)}
            </strong>
          </label>
          <label>
            <input
              type="radio"
              name={`${conflict.id}:${field}`}
              checked={choices[field] === "REMOTE"}
              onChange={() => setChoices({ ...choices, [field]: "REMOTE" })}
            />
            <span>已同步记录</span>
            <strong>{displayValue(field, current[field], courses)}</strong>
          </label>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={busy || fields.some((field) => !choices[field])}
        onClick={() => void submit()}
      >
        {busy ? "正在保存…" : "保留所选内容"}
      </button>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function ConflictPanel({
  conflicts,
  courses,
  onResolve,
}: {
  conflicts: ConflictDetail[];
  courses: Course[];
  onResolve: (
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) => Promise<void>;
}) {
  if (conflicts.length === 0) return null;
  return (
    <section className="conflict-panel" aria-label="需要选择的同步内容">
      <p className="eyebrow">SYNC</p>
      <h2>需要你选择保留的内容</h2>
      <p>同一处内容在不同设备上被修改。请选择每一处要保留的版本。</p>
      {conflicts.map((detail) => (
        <ConflictChoice
          key={detail.conflict.id}
          detail={detail}
          courses={courses}
          onResolve={onResolve}
        />
      ))}
    </section>
  );
}
