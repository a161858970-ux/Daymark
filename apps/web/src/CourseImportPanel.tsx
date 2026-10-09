import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  CourseImportCommitResult,
  CourseImportJob,
  CourseImportResolution,
} from "@daymark/contracts";
import type { Semester } from "@daymark/domain";
import {
  getCommittingJobId,
  subscribeCourseCommit,
} from "./courseCommitStore.js";
import { useI18n, useT, type Translate, weekdayLabels } from "./i18n/index.js";
import { toUserMessage } from "./errors.js";

interface Props {
  semester: Semester | null;
  available: boolean;
  onClose(): void;
  onLoadPending(semesterId: string): Promise<CourseImportJob[]>;
  onStart(semesterId: string, file: File): Promise<CourseImportJob>;
  onRetry(jobId: string, file: File): Promise<CourseImportJob>;
  onResolve(
    jobId: string,
    resolution: CourseImportResolution,
  ): Promise<CourseImportJob>;
  onCommit(jobId: string): Promise<CourseImportCommitResult>;
  onCommitted(result: CourseImportCommitResult): Promise<void>;
  onDiscard(jobId: string): Promise<void>;
}

function scheduleLabel(
  schedule: CourseImportJob["courses"][number]["schedules"][number],
  t: Translate,
  weekdays: readonly string[],
) {
  const week =
    schedule.week_start && schedule.week_end
      ? ` · ${t("course.importWeekSpan", {
          from: schedule.week_start,
          to: schedule.week_end,
        })}`
      : "";
  const place = schedule.classroom ? ` · ${schedule.classroom}` : "";
  // No clock time in the source: show the period label (节次) instead of
  // inventing a range.
  const timePart =
    schedule.start_time && schedule.end_time
      ? `${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
      : schedule.stage_label?.trim() || t("course.timePending");
  return `${weekdays[schedule.weekday - 1]} ${timePart}${week}${place}`;
}

export function CourseImportReview({
  job,
  busy,
  onResolve,
  onCommit,
  onDiscard,
}: {
  job: CourseImportJob;
  busy: boolean;
  onResolve(resolution: CourseImportResolution): void;
  onCommit(): void;
  onDiscard(): void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const weekdays = weekdayLabels(locale);
  return (
    <div className="course-import-review">
      <div className="course-import-summary">
        <p className="section-kicker">{t("course.importPreview")}</p>
        <strong>
          {t("course.importCourseCount", { count: job.courses.length })}
        </strong>
        <span>{t("course.importReviewNote")}</span>
      </div>
      <ol className="course-import-courses">
        {job.courses.map((course) => (
          <li key={course.name}>
            <div className="course-import-course-copy">
              <strong>{course.name}</strong>
              <span>{course.instructor ?? t("course.instructorUnknown")}</span>
            </div>
            {course.schedules.length ? (
              <ul className="course-import-schedules">
                {course.schedules.map((schedule, index) => (
                  <li
                    key={`${schedule.weekday}:${schedule.start_time ?? "none"}:${index}`}
                  >
                    {scheduleLabel(schedule, t, weekdays)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="course-import-no-schedule">
                {t("course.noScheduleDetected")}
              </p>
            )}
            {course.duplicate_candidates.length > 0 && (
              <fieldset className="course-import-duplicate">
                <legend>{t("course.importDuplicateLegend")}</legend>
                <p>{t("course.importDuplicateNote")}</p>
                <div>
                  {course.duplicate_candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className={
                        course.resolution?.decision === "SAME_COURSE" &&
                        course.resolution.existing_course_id === candidate.id
                          ? "selected"
                          : ""
                      }
                      disabled={busy}
                      onClick={() =>
                        onResolve({
                          incoming_course_name: course.name,
                          decision: "SAME_COURSE",
                          existing_course_id: candidate.id,
                        })
                      }
                    >
                      {t("course.importSameCourse")}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={
                      course.resolution?.decision === "NEW_COURSE"
                        ? "selected"
                        : "quiet-button"
                    }
                    disabled={busy}
                    onClick={() =>
                      onResolve({
                        incoming_course_name: course.name,
                        decision: "NEW_COURSE",
                      })
                    }
                  >
                    {t("course.importNewCourse")}
                  </button>
                </div>
              </fieldset>
            )}
          </li>
        ))}
      </ol>
      <div className="course-import-actions">
        <button
          type="button"
          className="primary-action course-import-commit"
          disabled={busy || job.status !== "READY"}
          onClick={onCommit}
        >
          {job.status === "NEEDS_RESOLUTION"
            ? t("course.importNeedsResolution")
            : busy
              ? t("course.importCreating")
              : t("course.importCommit")}
        </button>
        <button
          type="button"
          className="course-import-discard"
          disabled={busy}
          onClick={onDiscard}
        >
          {t("course.importDiscard")}
        </button>
      </div>
    </div>
  );
}

/**
 * Success copy for a commit. A true reuse (same file already imported and
 * every original course still alive) created nothing — claiming
 * "已建立 22 门课程" there sent the user looking for courses that were
 * never written.
 */
export function committedMessage(
  result: CourseImportCommitResult,
  t: Translate,
): string {
  return result.reused_existing_import
    ? t("course.importReused", { count: result.course_ids.length })
    : t("course.importCreated", { count: result.course_ids.length });
}

/**
 * A failed import must state its exact stored reason (timeout, unreadable
 * file, no courses…); older rows without a message fall back to the generic
 * hint. Nothing is written on failure, so "no courses" is always accurate.
 */
export function importFailureNote(
  job: CourseImportJob | null,
  t: Translate,
): string | null {
  if (!job || job.status !== "FAILED") return null;
  return job.error_message ?? t("course.importFailedHint");
}

export function CourseImportPanel({
  semester,
  available,
  onClose,
  onLoadPending,
  onStart,
  onRetry,
  onResolve,
  onCommit,
  onCommitted,
  onDiscard,
}: Props) {
  const t = useT();
  const [job, setJob] = useState<CourseImportJob | null>(null);
  const [loading, setLoading] = useState(available && Boolean(semester));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // The native input clears itself after upload; this keeps the chosen name
  // visible so the retry path shows which file is being re-sent.
  const [fileName, setFileName] = useState<string | null>(null);
  const requestRef = useRef(0);
  // Module state, not local: leaving the page mid-commit unmounts this
  // component, and coming back must still show the commit as running.
  const committingJobId = useSyncExternalStore(
    subscribeCourseCommit,
    getCommittingJobId,
    getCommittingJobId,
  );
  const committing = job !== null && committingJobId === job.id;

  useEffect(() => {
    if (!available || !semester) {
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    void onLoadPending(semester.id)
      .then((jobs) => {
        if (request === requestRef.current) setJob(jobs[0] ?? null);
      })
      .catch((cause: unknown) => {
        if (request === requestRef.current) setError(toUserMessage(cause));
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
    return () => {
      requestRef.current++;
    };
  }, [available, onLoadPending, semester]);

  async function selectFile(file: File | undefined) {
    if (!file || !semester) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      setJob(
        job ? await onRetry(job.id, file) : await onStart(semester.id, file),
      );
    } catch (cause) {
      setError(toUserMessage(cause));
      if (job) {
        const pending = await onLoadPending(semester.id).catch(() => []);
        setJob(pending.find((value) => value.id === job.id) ?? job);
      }
    } finally {
      setLoading(false);
    }
  }

  async function resolve(resolution: CourseImportResolution) {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      setJob(await onResolve(job.id, resolution));
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function discard() {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      await onDiscard(job.id);
      setJob(null);
      setSuccess(t("course.importDiscarded"));
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      const result = await onCommit(job.id);
      await onCommitted(result);
      setJob(null);
      setSuccess(committedMessage(result, t));
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="course-import-panel inline-reveal" aria-live="polite">
      <div className="course-import-heading">
        <div>
          <p className="section-kicker">{t("course.importKicker")}</p>
          <h3>{t("course.importTimetable")}</h3>
          <p>
            {semester
              ? t("course.importIntoSemester", { name: semester.name })
              : t("course.importNeedSemester")}
          </p>
        </div>
        <button type="button" className="quiet-button" onClick={onClose}>
          {t("common.collapse")}
        </button>
      </div>
      {!available && (
        <p className="course-import-note">{t("course.importUnavailable")}</p>
      )}
      {available && !semester && (
        <p className="course-import-note">
          {t("course.importCreateSemesterFirst")}
        </p>
      )}
      {available && semester && (
        <>
          <label className="course-import-file">
            <span>
              {job
                ? t("course.importReselectFile")
                : t("course.importSelectFile")}
            </span>
            <small>{t("course.importFileHint")}</small>
            <span className="course-import-file-row">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={loading || committing}
                aria-label={t("course.importSelectFile")}
                onChange={(event) => {
                  const input = event.currentTarget;
                  setFileName(input.files?.[0]?.name ?? null);
                  // Clear only after the async upload finishes: resetting the
                  // input here invalidates the File before fileBase64 reads it
                  // (token fetch runs first), which reported size 0 and made a
                  // 400 KB image fail the 15 MB guard.
                  void selectFile(input.files?.[0]).finally(() => {
                    input.value = "";
                  });
                }}
              />
              <span
                className={`course-import-file-button${loading ? " is-disabled" : ""}`}
                aria-hidden="true"
              >
                {t("course.importChooseFile")}
              </span>
              <span className="course-import-file-name">
                {fileName ?? t("course.importNoFile")}
              </span>
            </span>
          </label>
          {loading && (
            <p className="course-import-progress">{t("common.processing")}</p>
          )}
          {importFailureNote(job, t) && (
            <p className="course-import-note" role="alert">
              {importFailureNote(job, t)}
            </p>
          )}
          {job && job.courses.length > 0 && (
            <CourseImportReview
              job={job}
              busy={loading || committing}
              onResolve={(resolution) => void resolve(resolution)}
              onCommit={() => void commit()}
              onDiscard={() => void discard()}
            />
          )}
        </>
      )}
      {success && (
        <p className="course-import-success" role="status">
          {success}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
