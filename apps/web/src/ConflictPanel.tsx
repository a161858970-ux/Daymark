import { useState } from "react";
import type { ConflictResolution } from "@course-manager/contracts";
import type { Course, Semester } from "@course-manager/domain";
import type { ConflictDetail } from "./syncTransport.js";

type FieldChoice = "LOCAL" | "REMOTE" | "EXPLICIT";

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
  collection: "整组内容",
  name: "名称",
  instructor: "教师",
  semester_id: "所属学期",
  start_date: "开始日期",
  end_date: "结束日期",
};

function displayValue(
  field: string,
  value: unknown,
  courses: Course[],
  semesters: Semester[],
): string {
  if (field === "deleted_at") return value ? "删除" : "保留";
  if (field === "collection" && Array.isArray(value))
    return value.length === 0 ? "空" : `${value.length} 条记录`;
  if (value === null || value === undefined || value === "") return "未填写";
  if (field === "course_id" && typeof value === "string")
    return courses.find((course) => course.id === value)?.name ?? "未知课程";
  if (field === "semester_id" && typeof value === "string")
    return (
      semesters.find((semester) => semester.id === value)?.name ?? "未知学期"
    );
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

function ExplicitValueEditor({
  field,
  value,
  courses,
  semesters,
  onChange,
}: {
  field: string;
  value: unknown;
  courses: Course[];
  semesters: Semester[];
  onChange: (value: unknown) => void;
}) {
  if (field === "course_id")
    return (
      <select
        aria-label="自定义所属课程"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">无课程</option>
        {courses
          .filter((course) => course.deleted_at === null)
          .map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
      </select>
    );
  if (field === "semester_id")
    return (
      <select
        aria-label="自定义所属学期"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">无学期</option>
        {semesters
          .filter((semester) => semester.deleted_at === null)
          .map((semester) => (
            <option key={semester.id} value={semester.id}>
              {semester.name}
            </option>
          ))}
      </select>
    );
  const enumValues: Record<string, [string, string][]> = {
    status: [
      ["INCOMPLETE", "未完成"],
      ["COMPLETE", "已完成"],
    ],
    reminder_level: [
      ["OFF", "关闭提醒"],
      ["NORMAL", "一般提醒"],
      ["HIGH", "较多提醒"],
    ],
    processing_status: [
      ["RAW", "原始记录"],
      ["PROCESSING", "处理中"],
      ["RESOLVED", "已整理"],
      ["UNRESOLVED", "待确认"],
      ["DELETED", "已删除"],
    ],
  };
  if (enumValues[field])
    return (
      <select
        aria-label={`自定义${fieldNames[field] ?? "值"}`}
        value={typeof value === "string" ? value : enumValues[field]![0]![0]}
        onChange={(event) => onChange(event.target.value)}
      >
        {enumValues[field]!.map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
    );
  if (field === "start_date" || field === "end_date")
    return (
      <input
        aria-label={`自定义${fieldNames[field]}`}
        type="date"
        value={typeof value === "string" ? value.slice(0, 10) : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  if (field.endsWith("_at"))
    return (
      <input
        aria-label={`自定义${fieldNames[field] ?? "时间"}`}
        type="datetime-local"
        value={
          typeof value === "string" && value
            ? value.replace("Z", "").slice(0, 16)
            : ""
        }
        onChange={(event) =>
          onChange(
            event.target.value
              ? new Date(event.target.value).toISOString()
              : null,
          )
        }
      />
    );
  const nullable = new Set(["detail", "instructor", "unresolved_reason"]);
  const Input =
    field === "detail" || field === "content" ? "textarea" : "input";
  return (
    <Input
      aria-label={`自定义${fieldNames[field] ?? "值"}`}
      value={typeof value === "string" ? value : ""}
      onChange={(event) =>
        onChange(
          nullable.has(field) && event.target.value === ""
            ? null
            : event.target.value,
        )
      }
    />
  );
}

function ConflictChoice({
  detail,
  courses,
  semesters,
  onResolve,
}: {
  detail: ConflictDetail;
  courses: Course[];
  semesters: Semester[];
  onResolve: (
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) => Promise<void>;
}) {
  const { conflict, current_entity: current } = detail;
  const [choices, setChoices] = useState<Record<string, FieldChoice>>({});
  const [explicitValues, setExplicitValues] = useState<Record<string, unknown>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectName =
    conflict.entity_type === "ITEM"
      ? "事项"
      : conflict.entity_type === "COURSE_INFORMATION"
        ? "课程信息"
        : conflict.entity_type === "COURSE_SCHEDULE_COLLECTION"
          ? "课程安排"
          : conflict.entity_type === "SEMESTER_WEEK_COLLECTION"
            ? "学期周设置"
            : conflict.entity_type === "COURSE"
              ? "课程"
              : conflict.entity_type === "SEMESTER"
                ? "学期"
                : "原始记录";
  const name = String(
    current.title ??
      current.content ??
      current.raw_text ??
      (conflict.entity_type === "COURSE_SCHEDULE_COLLECTION"
        ? courses.find((course) => course.id === conflict.entity_id)?.name
        : null) ??
      objectName,
  );
  const fields = conflict.conflicting_fields;
  async function submit() {
    if (fields.some((field) => !choices[field])) return;
    const values = Object.fromEntries(
      fields.map((field) => [
        field,
        choices[field] === "EXPLICIT"
          ? { value: explicitValues[field] }
          : choices[field]!,
      ]),
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
    } catch {
      setError("未能保存选择。内容可能已变化，请重新加载后再选择。");
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
      {fields.includes("collection") && (
        <p>
          整组内容在不同设备上被修改。选择一组后会整体保存，不会混合两边的部分记录。
        </p>
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
              {displayValue(
                field,
                conflict.local_version[field],
                courses,
                semesters,
              )}
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
            <strong>
              {displayValue(field, current[field], courses, semesters)}
            </strong>
          </label>
          {field !== "collection" &&
            field !== "deleted_at" &&
            !current.deleted_at && (
              <label>
                <input
                  type="radio"
                  name={`${conflict.id}:${field}`}
                  checked={choices[field] === "EXPLICIT"}
                  onChange={() => {
                    setChoices({ ...choices, [field]: "EXPLICIT" });
                    if (!Object.hasOwn(explicitValues, field))
                      setExplicitValues({
                        ...explicitValues,
                        [field]: current[field],
                      });
                  }}
                />
                <span>自定义值</span>
                {choices[field] === "EXPLICIT" && (
                  <ExplicitValueEditor
                    field={field}
                    value={explicitValues[field]}
                    courses={courses}
                    semesters={semesters}
                    onChange={(value) =>
                      setExplicitValues({ ...explicitValues, [field]: value })
                    }
                  />
                )}
              </label>
            )}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={
          busy ||
          fields.some(
            (field) =>
              !choices[field] ||
              (choices[field] === "EXPLICIT" &&
                !Object.hasOwn(explicitValues, field)),
          )
        }
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
  semesters = [],
  onResolve,
}: {
  conflicts: ConflictDetail[];
  courses: Course[];
  semesters?: Semester[];
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
          semesters={semesters}
          onResolve={onResolve}
        />
      ))}
    </section>
  );
}
