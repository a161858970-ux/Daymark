import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ConflictResolution } from "@course-manager/contracts";
import type {
  ActionRequiredSyncIssue,
  ManualCaptureResolution,
} from "@course-manager/application";
import { semesterForDate } from "@course-manager/domain";
import type {
  Course,
  CourseInformation,
  CourseSchedule,
  Item,
  ItemAssociation,
  RawCapture,
  Semester,
  SemesterWeek,
} from "@course-manager/domain";
import { courseManager } from "./services.js";
import { ItemList } from "./ItemList.js";
import { ItemDetail, type EditableItemFields } from "./ItemDetail.js";
import { QuickCapture } from "./QuickCapture.js";
import { CourseInformationList } from "./CourseInformationList.js";
import { PendingCapture } from "./PendingCapture.js";
import {
  authClient,
  abandonActionRequiredIssue,
  openActionRequiredIssues,
  requestCaptureInterpretation,
  resolveSyncConflict,
  retryActionRequiredIssue,
  startAuthenticatedSync,
} from "./authSync.js";
import { ConflictPanel } from "./ConflictPanel.js";
import { AccountControl } from "./AccountControl.js";
import type { ConflictDetail } from "./syncTransport.js";
import { CalendarView } from "./CalendarView.js";
import { CourseIndex } from "./CourseIndex.js";
import { CourseDeleteConfirmation } from "./CourseDeleteConfirmation.js";
import {
  CourseScheduleList,
  type ScheduleFields,
} from "./CourseScheduleList.js";
import { SemesterSwitcher } from "./SemesterSwitcher.js";
import type { WeekFields } from "./SemesterWeekEditor.js";
import { localDate } from "./timeInputs.js";
import { SyncRepairPanel } from "./SyncRepairPanel.js";
import { AppNavigation, type PrimaryPage } from "./AppNavigation.js";

type Feedback = {
  message: string;
  action?: () => Promise<void>;
  duration: number;
};

export function App() {
  const [page, setPage] = useState<PrimaryPage>("overview");
  const [initializing, setInitializing] = useState(true);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [currentCourseId, setCurrentCourseId] = useState<string | null>(null);
  const [showCourseDelete, setShowCourseDelete] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [overviewItems, setOverviewItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [courseItems, setCourseItems] = useState<Item[]>([]);
  const [calendarItems, setCalendarItems] = useState<Item[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterWeeks, setSemesterWeeks] = useState<SemesterWeek[]>([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState<string | null>(
    null,
  );
  const [courseInformation, setCourseInformation] = useState<
    CourseInformation[]
  >([]);
  const [courseSchedules, setCourseSchedules] = useState<CourseSchedule[]>([]);
  const [courseTab, setCourseTab] = useState<
    "items" | "information" | "schedule"
  >("items");
  const [unresolved, setUnresolved] = useState<RawCapture[]>([]);
  const [unresolvedContexts, setUnresolvedContexts] = useState<
    Record<string, string | null>
  >({});
  const [dismissedThisLaunch, setDismissedThisLaunch] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [selectedRaw, setSelectedRaw] = useState<RawCapture | null>(null);
  const [itemAssociations, setItemAssociations] = useState<ItemAssociation[]>(
    [],
  );
  const [pendingMoveIds, setPendingMoveIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [courseItemText, setCourseItemText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<ConflictDetail[]>([]);
  const [syncIssues, setSyncIssues] = useState<ActionRequiredSyncIssue[]>([]);

  const refresh = useCallback(async () => {
    const now = new Date().toISOString();
    const today = localDate();
    const [
      courseData,
      allItemData,
      overviewData,
      unresolvedData,
      courseItemData,
      courseInformationData,
      courseScheduleData,
      calendarData,
      semesterData,
      selectedAssociationData,
    ] = await Promise.all([
      courseManager.listCourses(),
      courseManager.listItems(),
      courseManager.overview(today, now, selectedSemesterId ?? undefined),
      courseManager.unresolvedCaptures(),
      currentCourseId
        ? courseManager.courseItems(currentCourseId, now)
        : Promise.resolve([]),
      currentCourseId
        ? courseManager.courseInformation(currentCourseId)
        : Promise.resolve([]),
      currentCourseId
        ? courseManager.courseSchedules(currentCourseId)
        : Promise.resolve([]),
      courseManager.calendarItems(),
      courseManager.listSemesters(),
      selectedItem
        ? courseManager.itemAssociations(selectedItem.id)
        : Promise.resolve([]),
    ]);
    const weekGroups = await Promise.all(
      semesterData.map((semester) => courseManager.semesterWeeks(semester.id)),
    );
    setCourses(courseData);
    setAllItems(allItemData);
    setOverviewItems(overviewData);
    setUnresolved(unresolvedData);
    setUnresolvedContexts(
      Object.fromEntries(
        await Promise.all(
          unresolvedData.map(async (capture) => [
            capture.id,
            await courseManager.courseContextForCapture(capture.id),
          ]),
        ),
      ),
    );
    setCourseItems(courseItemData);
    setCourseInformation(courseInformationData);
    setCourseSchedules(courseScheduleData);
    setCalendarItems(calendarData);
    setSemesters(semesterData);
    setSemesterWeeks(weekGroups.flat());
    setItemAssociations(selectedAssociationData);
    if (selectedItem) {
      const next = await courseManager.getItem(selectedItem.id);
      if (next?.deleted_at) setSelectedItem(null);
      else if (next) setSelectedItem(next);
    }
  }, [currentCourseId, selectedItem?.id, selectedSemesterId]);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => {
        if (active) setInitializing(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    void courseManager
      .recoverPendingCaptures()
      .then(refresh)
      .catch((cause: unknown) => setError(String(cause)));
    void openActionRequiredIssues().then(setSyncIssues);
  }, []);
  useEffect(
    () =>
      startAuthenticatedSync(
        () => {
          void refresh();
        },
        () => setError("本机记录已关联另一账户，请使用原账户。"),
        setSyncConflicts,
        setSyncIssues,
      ),
    [refresh],
  );
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(
      () => setFeedback(null),
      feedback.duration,
    );
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function saveCapture(text: string, courseId: string | null = null) {
    try {
      const raw = await courseManager.capture(
        text,
        courseId ? "COURSE_ITEM" : "QUICK_CAPTURE",
        courseId,
      );
      setFeedback({ message: "✓ 已记录", duration: 2200 });
      void courseManager
        .processClearCapture(raw.id, courseId)
        .then(refresh)
        .catch((cause: unknown) => setError(String(cause)));
    } catch (cause) {
      setError(`记录未能保存在本机：${String(cause)}`);
      throw cause;
    }
  }

  async function openItem(item: Item) {
    setSelectedItem(item);
    setSelectedRaw((await courseManager.rawCaptureForItem(item.id)) ?? null);
    setItemAssociations(await courseManager.itemAssociations(item.id));
  }

  async function addItemAssociation(associatedItemId: string) {
    if (!selectedItem) return;
    await courseManager.associateItems(selectedItem.id, associatedItemId);
    setItemAssociations(await courseManager.itemAssociations(selectedItem.id));
  }

  async function removeItemAssociation(associationId: string) {
    if (!selectedItem) return;
    await courseManager.deleteItemAssociation(associationId);
    setItemAssociations(await courseManager.itemAssociations(selectedItem.id));
  }

  async function complete(item: Item) {
    try {
      const completed = await courseManager.completeItem(item.id);
      setPendingMoveIds((ids) => new Set(ids).add(item.id));
      setOverviewItems((items) =>
        items.map((value) => (value.id === item.id ? completed : value)),
      );
      setCourseItems((items) =>
        items.map((value) => (value.id === item.id ? completed : value)),
      );
      if (selectedItem?.id === item.id) setSelectedItem(completed);
      setFeedback({
        message: "✓ 已标记为完成",
        duration: 5000,
        action: async () => {
          await courseManager.restoreItem(item.id);
          setPendingMoveIds((ids) => {
            const next = new Set(ids);
            next.delete(item.id);
            return next;
          });
          await refresh();
        },
      });
      window.setTimeout(() => {
        setPendingMoveIds((ids) => {
          const next = new Set(ids);
          next.delete(item.id);
          return next;
        });
        void refresh();
      }, 420);
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function restore(item: Item) {
    try {
      setSelectedItem(await courseManager.restoreItem(item.id));
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function remove(item: Item) {
    try {
      const deleted = await courseManager.deleteItem(item.id);
      setSelectedItem(null);
      await refresh();
      setFeedback({
        message: `已删除“${item.title}”`,
        duration: 5000,
        action: async () => {
          await courseManager.undoDelete(item.id, deleted.token);
          await refresh();
        },
      });
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function saveEdit(item: Item, fields: EditableItemFields) {
    try {
      setSelectedItem(await courseManager.updateItem(item.id, fields));
      await refresh();
    } catch (cause) {
      setError(String(cause));
      throw cause;
    }
  }

  async function addCourseItem(event: FormEvent) {
    event.preventDefault();
    if (!currentCourseId || !courseItemText.trim()) return;
    try {
      await saveCapture(courseItemText, currentCourseId);
      setCourseItemText("");
    } catch {
      /* saveCapture already reports the failure */
    }
  }

  async function addInformation(content: string) {
    if (!currentCourseId) return;
    try {
      await courseManager.addCourseInformation(currentCourseId, content);
      await refresh();
    } catch (cause) {
      setError(String(cause));
      throw cause;
    }
  }

  async function replaceSchedules(values: ScheduleFields[]) {
    if (!currentCourseId) return;
    await courseManager.replaceCourseSchedules(currentCourseId, values);
    await refresh();
  }

  async function deleteCourse(
    strategy: "DELETE_ASSOCIATED_ITEMS" | "UNLINK_ASSOCIATED_ITEMS",
  ) {
    if (!activeCourse) return;
    await courseManager.deleteCourseWithStrategy(
      activeCourse.id,
      strategy,
      courseItems.map((item) => item.id),
    );
    setCurrentCourseId(null);
    setShowCourseDelete(false);
    setSelectedItem(null);
    setFeedback({ message: "课程已删除", duration: 4000 });
  }

  async function editInformation(id: string, content: string) {
    try {
      await courseManager.updateCourseInformation(id, content);
      await refresh();
    } catch (cause) {
      setError(String(cause));
      throw cause;
    }
  }

  async function deleteInformation(id: string) {
    try {
      await courseManager.deleteCourseInformation(id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function resolvePending(
    captureId: string,
    resolution: ManualCaptureResolution,
    keepOne = false,
  ) {
    await courseManager.resolveRawCapture(
      captureId,
      resolution,
      keepOne ? "KEEP_ONE" : null,
    );
    await refresh();
  }

  async function splitPending(
    captureId: string,
    resolutions: Extract<ManualCaptureResolution, { kind: "ITEM" }>[],
  ) {
    await courseManager.resolveSplitCapture(captureId, resolutions);
    await refresh();
  }

  async function deferPending(captureId: string) {
    try {
      await courseManager.deferRawCapture(captureId);
      setDismissedThisLaunch((ids) => new Set(ids).add(captureId));
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function deletePending(captureId: string) {
    try {
      await courseManager.deleteUnresolvedCapture(captureId);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function resolveConflict(
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) {
    const result = await resolveSyncConflict(id, version, resolution);
    setSyncConflicts(result.conflicts);
    if (result.undo)
      setFeedback({
        message: "已删除事项",
        duration: 5000,
        action: async () => {
          await courseManager.undoDelete(
            result.undo!.itemId,
            result.undo!.token,
          );
          await refresh();
        },
      });
    await refresh();
  }

  async function inspectSyncIssue(issue: ActionRequiredSyncIssue) {
    const object = issue.local_object;
    switch (issue.mutation.entity_type) {
      case "ITEM": {
        const item = await courseManager.getItem(issue.mutation.entity_id);
        if (item) await openItem(item);
        return;
      }
      case "COURSE_INFORMATION":
        setPage("courses");
        setCurrentCourseId(String(object?.course_id ?? "") || null);
        setCourseTab("information");
        return;
      case "COURSE_SCHEDULE_COLLECTION":
        setPage("courses");
        setCurrentCourseId(issue.mutation.entity_id);
        setCourseTab("schedule");
        return;
      case "SEMESTER_WEEK_COLLECTION":
      case "SEMESTER":
        setPage("courses");
        setCurrentCourseId(null);
        setSelectedSemesterId(issue.mutation.entity_id);
        return;
      case "COURSE":
        setPage("courses");
        setCurrentCourseId(issue.mutation.entity_id);
        return;
      default:
        setPage("overview");
    }
  }

  async function retrySyncIssue(mutationId: string) {
    setSyncIssues(await retryActionRequiredIssue(mutationId));
    setFeedback({ message: "已重新提交当前内容", duration: 3500 });
    await refresh();
  }

  async function abandonSyncIssue(mutationId: string) {
    setSyncIssues(await abandonActionRequiredIssue(mutationId));
    setFeedback({ message: "正在恢复已同步状态", duration: 3500 });
    await refresh();
  }

  const activeCourse = courses.find((course) => course.id === currentCourseId);
  const activeSemesterId = semesterForDate(localDate(), semesters)?.id ?? null;
  const targetSemesterId = selectedSemesterId ?? activeSemesterId;
  const visibleCourses = courses.filter((course) =>
    selectedSemesterId
      ? course.semester_id === selectedSemesterId
      : course.semester_id === activeSemesterId || course.semester_id === null,
  );
  const pendingQuestions = unresolved.filter(
    (capture) => !dismissedThisLaunch.has(capture.id),
  );

  function navigate(nextPage: PrimaryPage) {
    setPage(nextPage);
    setSelectedItem(null);
    setShowCourseDelete(false);
  }

  return (
    <div className="app-shell">
      <AccountControl />
      <AppNavigation page={page} onNavigate={navigate} />
      <main className="main-content">
        {!online && (
          <div className="connection-status" role="status">
            <span aria-hidden="true" />
            <div>
              <strong>当前离线</strong>
              <small>新记录会先保存在本机，联网后继续同步。</small>
            </div>
          </div>
        )}
        <ConflictPanel
          conflicts={syncConflicts}
          courses={courses}
          semesters={semesters}
          onResolve={resolveConflict}
        />
        <SyncRepairPanel
          issues={syncIssues}
          courses={courses}
          onInspect={(issue) => void inspectSyncIssue(issue)}
          onRetry={retrySyncIssue}
          onAbandon={abandonSyncIssue}
        />
        {initializing && (
          <section className="surface-state loading-state" aria-busy="true">
            <span className="loading-mark" aria-hidden="true" />
            <div>
              <h1>正在读取本机记录</h1>
              <p>课程、事项与原始记录会从本地数据库恢复。</p>
            </div>
          </section>
        )}
        {!initializing && page === "overview" && (
          <>
            <header className="page-header">
              <div>
                <p className="eyebrow">ITEMS</p>
                <h1>事项总览</h1>
              </div>
              <SemesterSwitcher
                semesters={semesters}
                selectedId={selectedSemesterId}
                onChange={(id) => {
                  setSelectedSemesterId(id);
                  setCurrentCourseId(null);
                }}
              />
            </header>
            {pendingQuestions.length > 0 && (
              <section className="pending-panel" aria-label="待确认的记录">
                <h2>待确认的记录</h2>
                {pendingQuestions.map((capture) => (
                  <PendingCapture
                    key={capture.id}
                    capture={capture}
                    courses={courses}
                    contextCourseId={unresolvedContexts[capture.id] ?? null}
                    onResolve={(resolution, keepOne) =>
                      resolvePending(capture.id, resolution, keepOne)
                    }
                    onSplit={(resolutions) =>
                      splitPending(capture.id, resolutions)
                    }
                    onInterpret={
                      authClient
                        ? () =>
                            requestCaptureInterpretation(
                              capture.id,
                              unresolvedContexts[capture.id] ?? null,
                              courses
                                .filter((course) =>
                                  capture.raw_text.includes(course.name),
                                )
                                .slice(0, 20)
                                .map((course) => course.id),
                            )
                        : undefined
                    }
                    onDefer={() => deferPending(capture.id)}
                    onDelete={() => deletePending(capture.id)}
                  />
                ))}
              </section>
            )}
            <ItemList
              items={overviewItems}
              courses={courses}
              pendingMoveIds={pendingMoveIds}
              onOpen={(item) => void openItem(item)}
              onComplete={(item) => void complete(item)}
            />
            <QuickCapture onSave={(text) => saveCapture(text)} />
          </>
        )}
        {!initializing && page === "courses" && (
          <>
            <header className="page-header">
              <div>
                <p className="eyebrow">COURSES</p>
                <h1>{activeCourse?.name ?? "课程"}</h1>
              </div>
              <SemesterSwitcher
                semesters={semesters}
                selectedId={selectedSemesterId}
                onChange={(id) => {
                  setSelectedSemesterId(id);
                  setCurrentCourseId(null);
                }}
              />
              {activeCourse && (
                <div className="course-header-actions">
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => {
                      setCurrentCourseId(null);
                      setShowCourseDelete(false);
                    }}
                  >
                    全部课程
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setShowCourseDelete(true)}
                  >
                    删除课程
                  </button>
                </div>
              )}
            </header>
            {activeCourse ? (
              <>
                {showCourseDelete && (
                  <CourseDeleteConfirmation
                    course={activeCourse}
                    items={courseItems}
                    onCancel={() => setShowCourseDelete(false)}
                    onConfirm={deleteCourse}
                  />
                )}
                <div
                  className="course-tabs"
                  role="tablist"
                  aria-label="课程内容"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={courseTab === "items"}
                    className={courseTab === "items" ? "selected" : ""}
                    onClick={() => setCourseTab("items")}
                  >
                    事项
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={courseTab === "information"}
                    className={courseTab === "information" ? "selected" : ""}
                    onClick={() => setCourseTab("information")}
                  >
                    课程信息
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={courseTab === "schedule"}
                    className={courseTab === "schedule" ? "selected" : ""}
                    onClick={() => setCourseTab("schedule")}
                  >
                    课程安排
                  </button>
                </div>
                {courseTab === "items" ? (
                  <>
                    <form
                      className="course-item-form"
                      onSubmit={(event) => void addCourseItem(event)}
                    >
                      <input
                        value={courseItemText}
                        onChange={(event) =>
                          setCourseItemText(event.target.value)
                        }
                        placeholder="添加这门课的事项……"
                        aria-label="添加课程事项"
                      />
                      <button type="submit">添加事项</button>
                    </form>
                    <ItemList
                      items={courseItems}
                      courses={courses}
                      pendingMoveIds={pendingMoveIds}
                      onOpen={(item) => void openItem(item)}
                      onComplete={(item) => void complete(item)}
                    />
                  </>
                ) : courseTab === "information" ? (
                  <CourseInformationList
                    information={courseInformation}
                    onAdd={addInformation}
                    onEdit={editInformation}
                    onDelete={deleteInformation}
                  />
                ) : (
                  <CourseScheduleList
                    schedules={courseSchedules}
                    onReplace={replaceSchedules}
                  />
                )}
              </>
            ) : (
              <CourseIndex
                key={targetSemesterId ?? "none"}
                courses={visibleCourses}
                targetSemesterId={targetSemesterId}
                semester={
                  semesters.find((value) => value.id === targetSemesterId) ??
                  null
                }
                weeks={semesterWeeks.filter(
                  (value) => value.semester_id === targetSemesterId,
                )}
                onOpen={(courseId) => {
                  setCurrentCourseId(courseId);
                  setShowCourseDelete(false);
                }}
                onFindCandidate={(name, semesterId) =>
                  courseManager.priorCourseCandidate(name, semesterId)
                }
                onCreateCourse={async (name, semesterId, inheritFromId) => {
                  if (inheritFromId && semesterId)
                    await courseManager.createCourseWithInheritance(
                      name,
                      semesterId,
                      inheritFromId,
                    );
                  else
                    await courseManager.createCourse(
                      name,
                      semesterId,
                      localDate(),
                    );
                  await refresh();
                }}
                onCreateSemester={async (name, startDate, endDate) => {
                  await courseManager.createSemester(name, startDate, endDate);
                  await refresh();
                }}
                onReplaceWeeks={async (values: WeekFields[]) => {
                  if (!targetSemesterId) return;
                  await courseManager.replaceSemesterWeeks(
                    targetSemesterId,
                    values,
                  );
                  await refresh();
                }}
              />
            )}
          </>
        )}
        {!initializing && page === "calendar" && (
          <>
            <header className="page-header">
              <div>
                <p className="eyebrow">CALENDAR</p>
                <h1>日程</h1>
              </div>
            </header>
            <CalendarView
              items={calendarItems}
              semesters={semesters}
              semesterWeeks={semesterWeeks}
              onOpen={(item) => void openItem(item)}
            />
          </>
        )}
      </main>
      {selectedItem && (
        <ItemDetail
          item={selectedItem}
          courses={courses}
          rawCapture={selectedRaw}
          associations={itemAssociations.flatMap((association) => {
            const otherId =
              association.item_id_a === selectedItem.id
                ? association.item_id_b
                : association.item_id_a;
            const item = allItems.find((value) => value.id === otherId);
            return item ? [{ association, item }] : [];
          })}
          associationCandidates={allItems.filter(
            (item) =>
              item.deleted_at === null &&
              item.id !== selectedItem.id &&
              !itemAssociations.some(
                (association) =>
                  association.item_id_a === item.id ||
                  association.item_id_b === item.id,
              ),
          )}
          onClose={() => {
            setSelectedItem(null);
            setItemAssociations([]);
          }}
          onComplete={(item) => void complete(item)}
          onRestore={(item) => void restore(item)}
          onDelete={(item) => void remove(item)}
          onSave={saveEdit}
          onAssociate={addItemAssociation}
          onRemoveAssociation={removeItemAssociation}
        />
      )}
      {feedback && (
        <div className="feedback" role="status">
          <span>{feedback.message}</span>
          {feedback.action && (
            <button
              type="button"
              onClick={() => {
                const action = feedback.action;
                setFeedback(null);
                void action?.().catch((cause: unknown) =>
                  setError(String(cause)),
                );
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="关闭错误"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
