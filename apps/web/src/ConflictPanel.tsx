import { useState } from "react";
import type { ConflictResolution } from "@daymark/contracts";
import type { Course, Semester } from "@daymark/domain";
import type { ConflictDetail } from "./syncTransport.js";
import { AttentionSummary } from "./AttentionSummary.js";
import { DateTimeField } from "./DateTimeField.js";
import { SelectField } from "./SelectField.js";
import { scheduleSummary, type ScheduleFields } from "./scheduleSummary.js";
import { useT, type Translate } from "./i18n/index.js";

type FieldChoice = "LOCAL" | "REMOTE" | "EXPLICIT";

const fieldKeys: Record<string, string> = {
  title: "conflict.field.title",
  detail: "conflict.field.detail",
  course_id: "conflict.field.courseId",
  start_at: "conflict.field.startAt",
  occurrence_start_at: "conflict.field.occurrenceStartAt",
  occurrence_end_at: "conflict.field.occurrenceEndAt",
  due_at: "conflict.field.dueAt",
  reminder_level: "conflict.field.reminderLevel",
  status: "conflict.field.status",
  deleted_at: "conflict.field.deletedAt",
  content: "conflict.field.content",
  processing_status: "conflict.field.processingStatus",
  unresolved_reason: "conflict.field.unresolvedReason",
  collection: "conflict.field.collection",
  name: "conflict.field.name",
  instructor: "conflict.field.instructor",
  semester_id: "conflict.field.semesterId",
  start_date: "conflict.field.startDate",
  end_date: "conflict.field.endDate",
};

const statusKeys: Record<string, string> = {
  COMPLETE: "conflict.status.complete",
  INCOMPLETE: "conflict.status.incomplete",
  OFF: "conflict.status.reminderOff",
  NORMAL: "conflict.status.reminderNormal",
  HIGH: "conflict.status.reminderHigh",
  RAW: "conflict.status.raw",
  PROCESSING: "conflict.status.processing",
  RESOLVED: "conflict.status.resolved",
  UNRESOLVED: "conflict.status.unresolved",
  DELETED: "conflict.status.deleted",
};

const entityKeys: Record<string, string> = {
  ITEM: "conflict.entity.item",
  COURSE_INFORMATION: "conflict.entity.courseInformation",
  COURSE_SCHEDULE_COLLECTION: "conflict.entity.courseSchedule",
  SEMESTER_WEEK_COLLECTION: "conflict.entity.semesterWeeks",
  COURSE: "conflict.entity.course",
  SEMESTER: "conflict.entity.semester",
};

function fieldName(t: Translate, field: string): string {
  return t(fieldKeys[field] ?? "conflict.valueLabel");
}

/**
 * A whole-group conflict (spec 17 §9) must let the user compare what each
 * option actually contains — "N 条记录" is not a decision.
 */
function collectionLines(t: Translate, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") return String(raw);
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.weekday === "number" &&
      (entry.start_time === null || typeof entry.start_time === "string") &&
      (entry.end_time === null || typeof entry.end_time === "string") &&
      entry.start_time !== undefined &&
      entry.end_time !== undefined
    )
      return scheduleSummary(entry as unknown as ScheduleFields);
    if (typeof entry.week_number === "number")
      return t("conflict.collectionWeek", {
        week: entry.week_number,
        start: String(entry.start_date ?? ""),
        end: String(entry.end_date ?? ""),
      });
    // Only human-readable fields: ids, versions and timestamps stay out
    // (ADR-004 — the panel never exposes sync internals).
    for (const key of ["title", "name", "content", "classroom"]) {
      const candidate = entry[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return t("common.recordedAt", { index: index + 1 });
  });
}

function CollectionValue({ value }: { value: unknown }) {
  const t = useT();
  const lines = collectionLines(t, value);
  if (lines.length === 0)
    return (
      <em className="conflict-collection-empty">
        {t("conflict.collectionEmpty")}
      </em>
    );
  return (
    <ul className="conflict-collection">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

function displayValue(
  t: Translate,
  field: string,
  value: unknown,
  courses: Course[],
  semesters: Semester[],
): string {
  if (field === "deleted_at")
    return value ? t("conflict.deleted") : t("conflict.kept");
  if (field === "collection" && Array.isArray(value))
    return value.length === 0
      ? t("conflict.empty")
      : t("conflict.collectionCount", { count: value.length });
  if (value === null || value === undefined || value === "")
    return t("conflict.unfilled");
  if (field === "course_id" && typeof value === "string")
    return (
      courses.find((course) => course.id === value)?.name ??
      t("common.unknownCourse")
    );
  if (field === "semester_id" && typeof value === "string")
    return (
      semesters.find((semester) => semester.id === value)?.name ??
      t("common.unknownSemester")
    );
  if (typeof value === "string" && value in statusKeys)
    return t(statusKeys[value]!);
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
  const t = useT();
  const label = fieldName(t, field);
  if (field === "course_id")
    return (
      <SelectField
        ariaLabel={t("conflict.customCourse")}
        label={t("conflict.field.courseId")}
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next || null)}
        options={[
          { value: "", label: t("common.noCourse") },
          ...courses
            .filter((course) => course.deleted_at === null)
            .map((course) => ({ value: course.id, label: course.name })),
        ]}
      />
    );
  if (field === "semester_id")
    return (
      <SelectField
        ariaLabel={t("conflict.customSemester")}
        label={t("conflict.field.semesterId")}
        value={typeof value === "string" ? value : ""}
        onChange={(next) => onChange(next || null)}
        options={[
          { value: "", label: t("common.noSemester") },
          ...semesters
            .filter((semester) => semester.deleted_at === null)
            .map((semester) => ({ value: semester.id, label: semester.name })),
        ]}
      />
    );
  const enumValues: Record<string, [string, string][]> = {
    status: [
      ["INCOMPLETE", t("conflict.enum.statusIncomplete")],
      ["COMPLETE", t("conflict.enum.statusComplete")],
    ],
    reminder_level: [
      ["OFF", t("conflict.enum.reminderOff")],
      ["NORMAL", t("conflict.enum.reminderNormal")],
      ["HIGH", t("conflict.enum.reminderHigh")],
    ],
    processing_status: [
      ["RAW", t("conflict.enum.processingRaw")],
      ["PROCESSING", t("conflict.enum.processingProcessing")],
      ["RESOLVED", t("conflict.enum.processingResolved")],
      ["UNRESOLVED", t("conflict.enum.processingUnresolved")],
      ["DELETED", t("conflict.enum.processingDeleted")],
    ],
  };
  if (enumValues[field])
    return (
      <SelectField
        ariaLabel={t("conflict.customAria", { field: label })}
        label={label}
        value={typeof value === "string" ? value : enumValues[field]![0]![0]}
        onChange={onChange}
        options={enumValues[field]!.map(([option, optionLabel]) => ({
          value: option,
          label: optionLabel,
        }))}
      />
    );
  if (field === "start_date" || field === "end_date")
    return (
      <DateTimeField
        mode="date"
        label={label || t("conflict.dateLabel")}
        ariaLabel={t("conflict.customAria", { field: label })}
        value={typeof value === "string" ? value.slice(0, 10) : ""}
        onChange={onChange}
      />
    );
  if (field.endsWith("_at"))
    return (
      <DateTimeField
        mode="datetime"
        label={label || t("conflict.timeLabel")}
        ariaLabel={t("conflict.customAria", {
          field: label || t("conflict.timeLabel"),
        })}
        value={
          typeof value === "string" && value
            ? value.replace("Z", "").slice(0, 16)
            : ""
        }
        onChange={(next) =>
          onChange(next ? new Date(next).toISOString() : null)
        }
      />
    );
  const nullable = new Set(["detail", "instructor", "unresolved_reason"]);
  const Input =
    field === "detail" || field === "content" ? "textarea" : "input";
  return (
    <Input
      aria-label={t("conflict.customAria", {
        field: label || t("conflict.valueLabel"),
      })}
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
  const t = useT();
  const { conflict, current_entity: current } = detail;
  const [choices, setChoices] = useState<Record<string, FieldChoice>>({});
  const [explicitValues, setExplicitValues] = useState<Record<string, unknown>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectName = t(
    entityKeys[conflict.entity_type] ?? "conflict.entity.rawCapture",
  );
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
      setError(t("conflict.saveFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`conflict-choice ${busy ? "resolving" : ""}`}>
      <p className="eyebrow">{objectName}</p>
      <h3>
        {current.deleted_at ? t("conflict.deletedTitle", { name }) : name}
      </h3>
      {Boolean(current.deleted_at) && <p>{t("conflict.deletedNotice")}</p>}
      {fields.includes("collection") && <p>{t("conflict.collectionNotice")}</p>}
      {fields.map((field) => (
        <fieldset key={field} className="conflict-field">
          <legend>{fieldName(t, field)}</legend>
          <label>
            <input
              type="radio"
              name={`${conflict.id}:${field}`}
              checked={choices[field] === "LOCAL"}
              disabled={Boolean(current.deleted_at)}
              onChange={() => setChoices({ ...choices, [field]: "LOCAL" })}
            />
            <span>{t("conflict.localValue")}</span>
            <strong>
              {displayValue(
                t,
                field,
                conflict.local_version[field],
                courses,
                semesters,
              )}
            </strong>
            {field === "collection" && (
              <CollectionValue value={conflict.local_version[field]} />
            )}
          </label>
          <label>
            <input
              type="radio"
              name={`${conflict.id}:${field}`}
              checked={choices[field] === "REMOTE"}
              onChange={() => setChoices({ ...choices, [field]: "REMOTE" })}
            />
            <span>{t("conflict.remoteValue")}</span>
            <strong>
              {displayValue(t, field, current[field], courses, semesters)}
            </strong>
            {field === "collection" && (
              <CollectionValue value={current[field]} />
            )}
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
                <span>{t("conflict.explicitValue")}</span>
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
        {busy ? t("common.saving") : t("conflict.keepSelected")}
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
  defaultExpanded = false,
}: {
  conflicts: ConflictDetail[];
  courses: Course[];
  semesters?: Semester[];
  onResolve: (
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) => Promise<void>;
  defaultExpanded?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (conflicts.length === 0) return null;
  return (
    <section
      className={`attention-panel conflict-panel ${expanded ? "expanded" : ""}`}
      aria-label={t("conflict.panelTitle")}
    >
      <AttentionSummary
        eyebrow="SYNC DECISION"
        title={t("conflict.title")}
        description={t("conflict.description")}
        count={conflicts.length}
        expanded={expanded}
        tone="conflict"
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <div className="attention-body">
          <p className="attention-intro">{t("conflict.intro")}</p>
          {conflicts.map((detail) => (
            <ConflictChoice
              key={detail.conflict.id}
              detail={detail}
              courses={courses}
              semesters={semesters}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}
    </section>
  );
}
