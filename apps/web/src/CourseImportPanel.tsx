import { useEffect, useRef, useState } from "react";
import type {
  CourseImportCommitResult,
  CourseImportJob,
  CourseImportResolution,
} from "@course-manager/contracts";
import type { Semester } from "@course-manager/domain";
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
) {
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const week =
    schedule.week_start && schedule.week_end
      ? ` · 第 ${schedule.week_start}–${schedule.week_end} 周`
      : "";
  const place = schedule.classroom ? ` · ${schedule.classroom}` : "";
  // No clock time in the source: show the period label (节次) instead of
  // inventing a range.
  const timePart =
    schedule.start_time && schedule.end_time
      ? `${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
      : schedule.stage_label?.trim() || "时间待定";
  return `周${weekdays[schedule.weekday - 1]} ${timePart}${week}${place}`;
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
  return (
    <div className="course-import-review">
      <div className="course-import-summary">
        <p className="section-kicker">识别预览</p>
        <strong>{job.courses.length} 门课程</strong>
        <span>确认课程与时间后再写入；这里不会生成事项。</span>
      </div>
      <ol className="course-import-courses">
        {job.courses.map((course) => (
          <li key={course.name}>
            <div className="course-import-course-copy">
              <strong>{course.name}</strong>
              <span>{course.instructor ?? "教师未识别"}</span>
            </div>
            {course.schedules.length ? (
              <ul className="course-import-schedules">
                {course.schedules.map((schedule, index) => (
                  <li
                    key={`${schedule.weekday}:${schedule.start_time ?? "none"}:${index}`}
                  >
                    {scheduleLabel(schedule)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="course-import-no-schedule">未识别到课程时间</p>
            )}
            {course.duplicate_candidates.length > 0 && (
              <fieldset className="course-import-duplicate">
                <legend>上一学期有严格同名课程，这是同一门课程吗？</legend>
                <p>确认相同后只继承课程信息，不复制历史事项或旧课表。</p>
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
                      是同一门，继承课程信息
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
                    不是，作为新课程
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
            ? "请先确认同名课程"
            : busy
              ? "正在建立课程…"
              : "确认并建立课程"}
        </button>
        <button
          type="button"
          className="course-import-discard"
          disabled={busy}
          onClick={onDiscard}
        >
          放弃本次识别
        </button>
      </div>
    </div>
  );
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
  const [job, setJob] = useState<CourseImportJob | null>(null);
  const [loading, setLoading] = useState(available && Boolean(semester));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestRef = useRef(0);

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
      setSuccess("已放弃本次识别，未写入任何课程。");
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
      setSuccess(`已建立 ${result.course_ids.length} 门课程。`);
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
          <p className="section-kicker">COURSE IMPORT</p>
          <h3>导入课程表</h3>
          <p>
            {semester
              ? `导入到 ${semester.name}。识别结果会先供你核对。`
              : "先创建学期，再导入该学期的课程表。"}
          </p>
        </div>
        <button type="button" className="quiet-button" onClick={onClose}>
          收起
        </button>
      </div>
      {!available && (
        <p className="course-import-note">
          课程表解析需要已配置并登录的同步账户；你仍可手动添加课程。
        </p>
      )}
      {available && !semester && (
        <p className="course-import-note">请先使用下方“创建学期”。</p>
      )}
      {available && semester && (
        <>
          <label className="course-import-file">
            <span>{job ? "重新选择课程表文件" : "选择课程表文件"}</span>
            <small>PDF、PNG、JPEG 或 WebP，最大 15 MB</small>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={loading}
              onChange={(event) => {
                const input = event.currentTarget;
                // Clear only after the async upload finishes: resetting the
                // input here invalidates the File before fileBase64 reads it
                // (token fetch runs first), which reported size 0 and made a
                // 400 KB image fail the 15 MB guard.
                void selectFile(input.files?.[0]).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
          {loading && <p className="course-import-progress">正在处理…</p>}
          {job?.status === "FAILED" && (
            <p className="course-import-note">
              上次识别没有写入任何课程，可以重新选择更清晰的文件。
            </p>
          )}
          {job && job.courses.length > 0 && (
            <CourseImportReview
              job={job}
              busy={loading}
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
