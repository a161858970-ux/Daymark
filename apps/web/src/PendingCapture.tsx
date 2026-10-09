import { useState, type FormEvent } from "react";
import {
  preprocessCapture,
  reminderLevelForCapture,
  type ManualCaptureResolution,
} from "@daymark/application";
import type { Course, RawCapture } from "@daymark/domain";
import { useT } from "./i18n/index.js";
import { SelectField } from "./SelectField.js";
import { TimeBlock } from "./TimeBlock.js";
import { fromLocalInput, toLocalInput } from "./timeInputs.js";
import type { CaptureInterpretation } from "./authSync.js";
import { toUserMessage } from "./errors.js";

interface Props {
  capture: RawCapture;
  courses: Course[];
  contextCourseId: string | null;
  onResolve(
    resolution: ManualCaptureResolution,
    keepOne?: boolean,
  ): Promise<void>;
  onSplit(
    resolutions: Extract<ManualCaptureResolution, { kind: "ITEM" }>[],
  ): Promise<void>;
  onInterpret?: (() => Promise<CaptureInterpretation>) | undefined;
  onDefer(): Promise<void>;
  onDelete(): Promise<void>;
}

/**
 * `unresolved_reason` values are persisted Chinese keys from
 * packages/application. Map them to message keys at this UI boundary only —
 * persistence keeps the original values. Unknown reasons fall back to the
 * raw stored string. User-entered capture text is never translated.
 */
const reasonMessageKeys: Record<string, string> = {
  需要确认记录类型: "capture.reasonType",
  需要确认时间语义: "capture.reasonTime",
  需要确认所属课程: "capture.reasonCourse",
  需要确认课程: "capture.reasonCourse",
  需要确认记录上下文: "capture.reasonContext",
  可能包含多个事项: "capture.reasonMulti",
};

export function PendingCapture({
  capture,
  courses,
  contextCourseId,
  onResolve,
  onSplit,
  onInterpret,
  onDefer,
  onDelete,
}: Props) {
  const t = useT();
  const splitCandidates = preprocessCapture({
    rawText: capture.raw_text,
    source: capture.source,
    contextCourseId,
    courses,
  }).splitCandidates;
  const [kind, setKind] = useState<
    "ITEM" | "COURSE_INFORMATION" | "SPLIT" | null
  >(null);
  const [splitTitles, setSplitTitles] = useState(splitCandidates);
  const [courseId, setCourseId] = useState(contextCourseId ?? "");
  const [title, setTitle] = useState(capture.raw_text.trim());
  const [detail, setDetail] = useState("");
  const [startAt, setStartAt] = useState("");
  const [occurrenceStartAt, setOccurrenceStartAt] = useState("");
  const [occurrenceEndAt, setOccurrenceEndAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  async function interpret() {
    if (!onInterpret || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onInterpret();
      // `uncertainty` is model copy delivered as-is; only our fallbacks localize.
      setSuggestion(
        result.uncertainty ??
          (result.classification === "MULTI_ITEM_CANDIDATE"
            ? t("capture.reasonMulti")
            : t("capture.suggestReview")),
      );
      if (result.course_candidate) {
        const matches = courses.filter(
          (course) => course.name === result.course_candidate,
        );
        if (matches.length === 1) setCourseId(matches[0]!.id);
      }
      if (result.classification === "MULTI_ITEM_CANDIDATE") {
        setSplitTitles(result.split_candidates);
      } else if (result.classification === "ITEM") {
        setTitle(result.title ?? capture.raw_text.trim());
        setDetail(result.detail ?? "");
        setStartAt(toLocalInput(result.start_at));
        setOccurrenceStartAt(toLocalInput(result.occurrence_start_at));
        setOccurrenceEndAt(toLocalInput(result.occurrence_end_at));
        setDueAt(toLocalInput(result.due_at));
        setKind("ITEM");
      } else if (result.classification === "COURSE_INFORMATION") {
        setTitle(result.course_information ?? capture.raw_text.trim());
        setKind("COURSE_INFORMATION");
      }
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kind || busy) return;
    setError(null);
    if (kind === "SPLIT") {
      setBusy(true);
      try {
        await onSplit(
          splitTitles.map((part) => ({
            kind: "ITEM",
            title: part.trim(),
            detail: null,
            course_id: courseId || null,
            start_at: null,
            occurrence_start_at: null,
            occurrence_end_at: null,
            due_at: null,
            reminder_level: reminderLevelForCapture(capture.raw_text),
          })),
        );
      } catch (cause) {
        setError(toUserMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (kind === "COURSE_INFORMATION" && !courseId) {
      setError(t("capture.needCourse"));
      return;
    }
    setBusy(true);
    try {
      const resolution: ManualCaptureResolution =
        kind === "ITEM"
          ? {
              kind,
              title: title.trim(),
              detail: detail.trim() || null,
              course_id: courseId || null,
              start_at: fromLocalInput(startAt),
              occurrence_start_at: fromLocalInput(occurrenceStartAt),
              occurrence_end_at: fromLocalInput(occurrenceEndAt),
              due_at: fromLocalInput(dueAt),
              reminder_level: reminderLevelForCapture(capture.raw_text),
            }
          : { kind, course_id: courseId, content: title.trim() };
      await onResolve(resolution, kind === "ITEM" && splitTitles.length > 1);
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const reasonKey = capture.unresolved_reason
    ? reasonMessageKeys[capture.unresolved_reason]
    : undefined;

  return (
    <article className={`pending-row ${busy ? "resolving" : ""}`}>
      <header className="pending-record-head">
        <p className="eyebrow">ORIGINAL NOTE</p>
        <h3>{capture.raw_text}</h3>
        <small>
          {capture.unresolved_reason
            ? reasonKey
              ? t(reasonKey)
              : capture.unresolved_reason
            : t("capture.reviewOriginal")}
        </small>
      </header>
      {suggestion && (
        <p className="capture-suggestion" role="status">
          {suggestion}
        </p>
      )}
      {!kind ? (
        <>
          <p className="pending-question">{t("capture.question")}</p>
          <div className="pending-actions">
            <button type="button" onClick={() => setKind("ITEM")}>
              {splitTitles.length > 1
                ? t("capture.keepOne")
                : t("capture.asItem")}
            </button>
            {splitTitles.length > 1 && (
              <button type="button" onClick={() => setKind("SPLIT")}>
                {t("capture.splitItems", { count: splitTitles.length })}
              </button>
            )}
            <button
              type="button"
              className="quiet-button"
              onClick={() => setKind("COURSE_INFORMATION")}
            >
              {t("capture.asCourseInfo")}
            </button>
            {onInterpret && (
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                onClick={() => void interpret()}
              >
                {t("capture.tryInterpret")}
              </button>
            )}
          </div>
        </>
      ) : (
        <form
          className="pending-resolution"
          onSubmit={(event) => void submit(event)}
        >
          {kind === "SPLIT" ? (
            splitTitles.map((part, index) => (
              <label key={index}>
                {t("capture.splitLabel", { index: index + 1 })}
                <input
                  value={part}
                  onChange={(event) =>
                    setSplitTitles((previous) =>
                      previous.map((value, position) =>
                        position === index ? event.target.value : value,
                      ),
                    )
                  }
                  required
                />
              </label>
            ))
          ) : (
            <label>
              {kind === "ITEM"
                ? t("item.titleLabel")
                : t("capture.courseInfoLabel")}
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
          )}
          <label>
            {t("item.courseLabel")}
            <SelectField
              value={courseId}
              onChange={setCourseId}
              label={t("item.courseLabel")}
              options={[
                {
                  value: "",
                  label:
                    kind === "COURSE_INFORMATION"
                      ? t("capture.selectCourse")
                      : t("item.noCourse"),
                },
                ...courses.map((course) => ({
                  value: course.id,
                  label: course.name,
                })),
              ]}
            />
          </label>
          {kind === "ITEM" && (
            <>
              <TimeBlock
                value={{
                  startAt,
                  occurrenceStartAt,
                  occurrenceEndAt,
                  dueAt,
                }}
                onChange={(next) => {
                  setStartAt(next.startAt);
                  setOccurrenceStartAt(next.occurrenceStartAt);
                  setOccurrenceEndAt(next.occurrenceEndAt);
                  setDueAt(next.dueAt);
                }}
              />
              <label>
                {t("item.detailField")}
                <textarea
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                />
              </label>
            </>
          )}
          <div className="pending-actions">
            <button type="submit" disabled={busy}>
              {t("capture.confirmSave")}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setKind(null)}
            >
              {t("capture.back")}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="pending-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => void onDefer()}
        >
          {t("capture.defer")}
        </button>
        <button
          type="button"
          className="text-button danger"
          onClick={() => void onDelete()}
        >
          {t("capture.delete")}
        </button>
      </div>
    </article>
  );
}
