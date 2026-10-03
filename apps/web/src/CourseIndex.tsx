import { useState, type FormEvent } from "react";
import type {
  CourseImportCommitResult,
  CourseImportJob,
  CourseImportResolution,
} from "@course-manager/contracts";
import type { Course, Semester, SemesterWeek } from "@course-manager/domain";
import { CourseImportPanel } from "./CourseImportPanel.js";
import { DateTimeField } from "./DateTimeField.js";
import { SemesterWeekEditor, type WeekFields } from "./SemesterWeekEditor.js";
import { toUserMessage } from "./errors.js";

interface Props {
  courses: Course[];
  targetSemesterId: string | null;
  semester: Semester | null;
  weeks: SemesterWeek[];
  incompleteCounts: Record<string, number>;
  onOpen(courseId: string): void;
  onFindCandidate(
    name: string,
    semesterId: string | null,
  ): Promise<Course | null>;
  onCreateCourse(
    name: string,
    semesterId: string | null,
    inheritFromId: string | null,
  ): Promise<void>;
  onCreateSemester(
    name: string,
    startDate: string,
    endDate: string,
  ): Promise<void>;
  onReplaceWeeks(values: WeekFields[]): Promise<void>;
  courseImportAvailable: boolean;
  onLoadPendingImports(semesterId: string): Promise<CourseImportJob[]>;
  onStartImport(semesterId: string, file: File): Promise<CourseImportJob>;
  onRetryImport(jobId: string, file: File): Promise<CourseImportJob>;
  onResolveImport(
    jobId: string,
    resolution: CourseImportResolution,
  ): Promise<CourseImportJob>;
  onCommitImport(jobId: string): Promise<CourseImportCommitResult>;
  onImportCommitted(result: CourseImportCommitResult): Promise<void>;
  onDiscardImport(jobId: string): Promise<void>;
}

export function CourseIndex({
  courses,
  targetSemesterId,
  semester,
  weeks,
  incompleteCounts,
  onOpen,
  onFindCandidate,
  onCreateCourse,
  onCreateSemester,
  onReplaceWeeks,
  courseImportAvailable,
  onLoadPendingImports,
  onStartImport,
  onRetryImport,
  onResolveImport,
  onCommitImport,
  onImportCommitted,
  onDiscardImport,
}: Props) {
  const [courseName, setCourseName] = useState("");
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [candidate, setCandidate] = useState<Course | null>(null);
  const [semesterName, setSemesterName] = useState("");
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  const [showSemesterForm, setShowSemesterForm] = useState(false);
  const [showWeekEditor, setShowWeekEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createCourse(inheritFromId: string | null) {
    try {
      await onCreateCourse(courseName, targetSemesterId, inheritFromId);
      setCourseName("");
      setCandidate(null);
      setShowCourseForm(false);
      setError(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function submitCourse(event: FormEvent) {
    event.preventDefault();
    if (!courseName.trim()) return;
    try {
      if (
        courses.some(
          (course) =>
            course.semester_id === targetSemesterId &&
            course.name === courseName.trim(),
        )
      ) {
        setError("此学期已有同名课程，请打开已有课程核对。");
        return;
      }
      const found = await onFindCandidate(courseName.trim(), targetSemesterId);
      if (found) setCandidate(found);
      else await createCourse(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function submitSemester(event: FormEvent) {
    event.preventDefault();
    try {
      await onCreateSemester(semesterName, semesterStart, semesterEnd);
      setSemesterName("");
      setSemesterStart("");
      setSemesterEnd("");
      setShowSemesterForm(false);
      setError(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  return (
    <section className="course-index" aria-label="课程索引">
      <div className="course-index-intro">
        <div>
          <p className="section-kicker">{semester?.name ?? "无学期归属"}</p>
          <h2>课程索引</h2>
          <p>打开一门课程，查看它的事项与课程信息。</p>
        </div>
        <div className="course-index-actions">
          <button
            type="button"
            className="quiet-button"
            aria-expanded={showImport}
            onClick={() => {
              setShowImport(!showImport);
              setShowCourseForm(false);
              setCandidate(null);
              setError(null);
            }}
          >
            导入课程表
          </button>
          <button
            type="button"
            className="secondary-action"
            aria-expanded={showCourseForm}
            onClick={() => {
              setShowCourseForm(!showCourseForm);
              setShowImport(false);
              setCandidate(null);
              setError(null);
            }}
          >
            {showCourseForm ? "收起" : "＋ 添加课程"}
          </button>
        </div>
      </div>
      {showImport && (
        <CourseImportPanel
          semester={semester}
          available={courseImportAvailable}
          onClose={() => setShowImport(false)}
          onLoadPending={onLoadPendingImports}
          onStart={onStartImport}
          onRetry={onRetryImport}
          onResolve={onResolveImport}
          onCommit={onCommitImport}
          onCommitted={onImportCommitted}
          onDiscard={onDiscardImport}
        />
      )}
      {showCourseForm && (
        <form
          className="course-create inline-reveal"
          onSubmit={(event) => void submitCourse(event)}
        >
          <input
            value={courseName}
            onChange={(event) => {
              setCourseName(event.target.value);
              setCandidate(null);
            }}
            placeholder="输入课程名称"
            aria-label="课程名称"
            autoFocus
          />
          <button type="submit">保存课程</button>
        </form>
      )}
      {candidate && (
        <section className="course-candidate" aria-label="同名课程确认">
          <p>此前学期有同名课程“{candidate.name}”。这是同一门课程吗？</p>
          <p className="course-candidate-note">
            确认后仅继承课程信息，不复制历史事项或新学期课表。
          </p>
          <div>
            <button
              type="button"
              onClick={() => void createCourse(candidate.id)}
            >
              是，继承课程信息
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void createCourse(null)}
            >
              不是，独立新建
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setCandidate(null)}
            >
              取消
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <ul className="course-list">
        {courses.map((course) => (
          <li key={course.id}>
            <button type="button" onClick={() => onOpen(course.id)}>
              <span className="course-row-copy">
                <strong>{course.name}</strong>
                <span>{incompleteCounts[course.id] ?? 0} 项未完成</span>
              </span>
              <span className="course-row-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
      {courses.length === 0 && (
        <p className="empty-state">
          此学期视角下还没有课程；你也可以先记录无课程事项。
        </p>
      )}
      <div className="semester-create-area">
        {semester && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => setShowWeekEditor(!showWeekEditor)}
          >
            {showWeekEditor ? "收起周次设置" : "设置学期周次"}
          </button>
        )}
        {semester && showWeekEditor && (
          <SemesterWeekEditor
            semester={semester}
            weeks={weeks}
            onReplace={onReplaceWeeks}
          />
        )}
        <button
          type="button"
          className="quiet-button"
          onClick={() => setShowSemesterForm(!showSemesterForm)}
        >
          {showSemesterForm ? "收起学期设置" : "＋ 创建学期"}
        </button>
        {showSemesterForm && (
          <form
            className="semester-create"
            onSubmit={(event) => void submitSemester(event)}
          >
            <input
              aria-label="学期名称"
              placeholder="例如：2026 秋季学期"
              value={semesterName}
              onChange={(event) => setSemesterName(event.target.value)}
              required
            />
            <label>
              开始日期
              <DateTimeField
                mode="date"
                label="学期开始日期"
                ariaLabel="学期开始日期"
                required
                value={semesterStart}
                onChange={setSemesterStart}
              />
            </label>
            <label>
              结束日期
              <DateTimeField
                mode="date"
                label="学期结束日期"
                ariaLabel="学期结束日期"
                required
                value={semesterEnd}
                onChange={setSemesterEnd}
              />
            </label>
            <button type="submit">保存学期</button>
          </form>
        )}
      </div>
    </section>
  );
}
