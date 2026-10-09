import { useEffect, useState, type FormEvent } from "react";
import type {
  CourseImportCommitResult,
  CourseImportJob,
  CourseImportResolution,
} from "@daymark/contracts";
import type { Course, Semester, SemesterWeek } from "@daymark/domain";
import { CourseImportPanel } from "./CourseImportPanel.js";
import { getCommittingJobId } from "./courseCommitStore.js";
import { DateTimeField } from "./DateTimeField.js";
import { useT } from "./i18n/index.js";
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
  onDeleteSemester(id: string): Promise<void>;
  /** 0 = idle; each bump reopens the import panel for a finished task. */
  openImportSignal?: number;
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
  onDeleteSemester,
  openImportSignal,
  courseImportAvailable,
  onLoadPendingImports,
  onStartImport,
  onRetryImport,
  onResolveImport,
  onCommitImport,
  onImportCommitted,
  onDiscardImport,
}: Props) {
  const t = useT();
  const [courseName, setCourseName] = useState("");
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [candidate, setCandidate] = useState<Course | null>(null);
  const [semesterName, setSemesterName] = useState("");
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  const [showSemesterForm, setShowSemesterForm] = useState(false);
  const [showWeekEditor, setShowWeekEditor] = useState(false);
  const [showSemesterDelete, setShowSemesterDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopened when the user clicks a finished import task in the AI hint.
  useEffect(() => {
    if (openImportSignal) setShowImport(true);
  }, [openImportSignal]);

  // Walking away mid-commit and coming back must land on the import panel
  // again (with its busy state from courseCommitStore) instead of a blank
  // course list — the commit never stopped running.
  useEffect(() => {
    if (getCommittingJobId()) setShowImport(true);
  }, []);

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
        setError(t("course.duplicateNameError"));
        return;
      }
      const found = await onFindCandidate(courseName.trim(), targetSemesterId);
      if (found) setCandidate(found);
      else await createCourse(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function confirmSemesterDelete() {
    if (!semester) return;
    try {
      await onDeleteSemester(semester.id);
      setShowSemesterDelete(false);
    } catch {
      // App 层负责展示错误；确认块保留，允许重试。
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
    <section className="course-index" aria-label={t("course.indexTitle")}>
      <div className="course-index-intro">
        <div>
          <p className="section-kicker">
            {semester?.name ?? t("course.semesterNone")}
          </p>
          <h2>{t("course.indexTitle")}</h2>
          <p>{t("course.indexDeck")}</p>
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
            {t("course.importTimetable")}
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
            {showCourseForm ? t("common.collapse") : t("course.addCourse")}
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
            placeholder={t("course.courseNamePlaceholder")}
            aria-label={t("course.courseName")}
            autoFocus
          />
          <button type="submit">{t("course.saveCourse")}</button>
        </form>
      )}
      {candidate && (
        <section
          className="course-candidate"
          aria-label={t("course.duplicateConfirmTitle")}
        >
          <p>{t("course.duplicatePrompt", { name: candidate.name })}</p>
          <p className="course-candidate-note">
            {t("course.duplicateInheritNote")}
          </p>
          <div>
            <button
              type="button"
              onClick={() => void createCourse(candidate.id)}
            >
              {t("course.duplicateYes")}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void createCourse(null)}
            >
              {t("course.duplicateNo")}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setCandidate(null)}
            >
              {t("common.cancel")}
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
                <span>
                  {t("course.openCount", {
                    count: incompleteCounts[course.id] ?? 0,
                  })}
                </span>
              </span>
              <span className="course-row-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
      {courses.length === 0 && (
        <p className="empty-state">{t("course.emptyCourses")}</p>
      )}
      <div className="semester-create-area">
        {semester && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => setShowWeekEditor(!showWeekEditor)}
          >
            {showWeekEditor
              ? t("course.collapseWeekSettings")
              : t("course.weekSettings")}
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
          {showSemesterForm
            ? t("course.collapseSemesterSettings")
            : t("course.semesterSettings")}
        </button>
        {semester && !showSemesterDelete && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => setShowSemesterDelete(true)}
          >
            {t("course.deleteSemester")}
          </button>
        )}
        {semester && showSemesterDelete && (
          <div
            className="course-delete-confirmation"
            role="group"
            aria-label={t("course.deleteSemesterConfirm")}
          >
            <p>
              {t("course.deleteSemesterWarning", {
                name: semester.name,
                count: courses.length,
              })}
            </p>
            <div className="course-delete-actions">
              <button
                type="button"
                className="danger"
                onClick={() => void confirmSemesterDelete()}
              >
                {t("course.confirmDelete")}
              </button>
              <button
                type="button"
                onClick={() => setShowSemesterDelete(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
        {showSemesterForm && (
          <form
            className="semester-create"
            onSubmit={(event) => void submitSemester(event)}
          >
            <input
              aria-label={t("course.semesterName")}
              placeholder={t("course.semesterNamePlaceholder")}
              value={semesterName}
              onChange={(event) => setSemesterName(event.target.value)}
              required
            />
            <label>
              {t("course.startDate")}
              <DateTimeField
                mode="date"
                label={t("course.startDateLabel")}
                ariaLabel={t("course.startDateLabel")}
                required
                value={semesterStart}
                onChange={setSemesterStart}
              />
            </label>
            <label>
              {t("course.endDate")}
              <DateTimeField
                mode="date"
                label={t("course.endDateLabel")}
                ariaLabel={t("course.endDateLabel")}
                required
                value={semesterEnd}
                onChange={setSemesterEnd}
              />
            </label>
            <button type="submit">{t("course.saveSemester")}</button>
          </form>
        )}
      </div>
    </section>
  );
}
