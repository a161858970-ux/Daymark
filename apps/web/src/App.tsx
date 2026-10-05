import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
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
import { courseManager, localRepository } from "./services.js";
import { ItemList } from "./ItemList.js";
import { ItemDetail, type EditableItemFields } from "./ItemDetail.js";
import { QuickCapture } from "./QuickCapture.js";
import { CourseInformationList } from "./CourseInformationList.js";
import { PendingCapture } from "./PendingCapture.js";
import {
  authClient,
  abandonActionRequiredIssue,
  currentAccessToken,
  openActionRequiredIssues,
  requestCaptureInterpretation,
  requestSyncNow,
  resolveSyncConflict,
  retryActionRequiredIssue,
  retryAuthenticatedSync,
  startAuthenticatedSync,
  type AuthenticatedSyncStatus,
} from "./authSync.js";
import { ConflictPanel } from "./ConflictPanel.js";
import { AccountControl } from "./AccountControl.js";
import type { ConflictDetail } from "./syncTransport.js";
import { CalendarView } from "./CalendarView.js";
import { CourseIndex } from "./CourseIndex.js";
import {
  commitCourseImport,
  discardCourseImport,
  pendingCourseImports,
  resolveImportedCourse,
  retryCourseImport,
  startCourseImport,
} from "./courseImportClient.js";
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
import { GlobalSearchButton, SearchSurface } from "./SearchSurface.js";
import { AttentionSummary } from "./AttentionSummary.js";
import {
  ErrorNotice,
  TransientFeedback,
  type FeedbackNotice,
} from "./TransientNotice.js";
import { motionDuration } from "./motion.js";
import {
  BrowserNotificationAdapter,
  ReminderScheduler,
  WebReminderDeliveryPort,
  createAppReminderWindow,
  loadReminderPolicy,
  loadReminderRuntimeConfig,
  localDeviceId,
} from "./reminders.js";
import { toUserMessage } from "./errors.js";
import type { AiTaskKind } from "./aiTaskStore.js";

export function App() {
  const [page, setPage] = useState<PrimaryPage>("overview");
  /** Bumped to reopen the import panel when a finished AI task is clicked. */
  const [importOpenSignal, setImportOpenSignal] = useState(0);
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
  const [searchCourseInformation, setSearchCourseInformation] = useState<
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
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [enteringItemIds, setEnteringItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [feedback, setFeedback] = useState<FeedbackNotice | null>(null);
  const [courseItemText, setCourseItemText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<ConflictDetail[]>([]);
  const [syncIssues, setSyncIssues] = useState<ActionRequiredSyncIssue[]>([]);
  // Bumped by the account panel's 查看并处理 so the repair panel opens itself.
  const [repairOpenSignal, setRepairOpenSignal] = useState(0);
  const [syncStatus, setSyncStatus] = useState<AuthenticatedSyncStatus>(() => ({
    state: authClient ? "SIGNED_OUT" : "LOCAL_ONLY",
    checked_at: null,
  }));
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [highlightedInformationId, setHighlightedInformationId] = useState<
    string | null
  >(null);
  const detailRequestIdRef = useRef(0);
  const selectedItemIdRef = useRef<string | null>(null);
  selectedItemIdRef.current = selectedItem?.id ?? null;
  const completionTimersRef = useRef<Map<string, number>>(new Map());
  const deletionTimersRef = useRef<Map<string, number>>(new Map());
  const enteringTimersRef = useRef<Map<string, number>>(new Map());
  const feedbackIdRef = useRef(0);
  const allItemsRef = useRef<Item[]>([]);
  allItemsRef.current = allItems;
  const openItemRef = useRef<(item: Item) => void>(() => {});
  openItemRef.current = openItem;
  const reminderTickRef = useRef<(() => Promise<number>) | null>(null);

  const refresh = useCallback(async () => {
    const now = new Date().toISOString();
    const today = localDate();
    const requestedSelectedItemId = selectedItem?.id ?? null;
    const [
      courseData,
      allItemData,
      overviewData,
      unresolvedData,
      courseItemData,
      courseInformationData,
      allCourseInformationData,
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
      courseManager.allCourseInformation(),
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
    setSearchCourseInformation(allCourseInformationData);
    setCourseSchedules(courseScheduleData);
    setCalendarItems(calendarData);
    setSemesters(semesterData);
    setSemesterWeeks(weekGroups.flat());
    if (selectedItemIdRef.current === requestedSelectedItemId) {
      setItemAssociations(selectedAssociationData);
      if (requestedSelectedItemId) {
        const next = await courseManager.getItem(requestedSelectedItemId);
        if (selectedItemIdRef.current !== requestedSelectedItemId) return;
        if (next?.deleted_at) setSelectedItem(null);
        else if (next) setSelectedItem(next);
      }
    }
    // Completion, deletion and time edits land here, so stale reminder keys
    // are canceled promptly instead of waiting for the interval.
    void reminderTickRef.current?.();
    // A local write should reach the other device without waiting for the
    // next poll tick; no-ops unless the outbox actually holds something.
    requestSyncNow();
  }, [currentCourseId, selectedItem?.id, selectedSemesterId]);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((cause: unknown) => setError(toUserMessage(cause)))
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

  // Reminder delivery: derive the schedule with the product R-01 policy,
  // claim while online, then show a platform notification.
  useEffect(() => {
    const policy = loadReminderPolicy();
    const runtime = loadReminderRuntimeConfig();
    let scheduler: ReminderScheduler | null = null;
    const adapter = new BrowserNotificationAdapter(
      (item, logicalKey) => {
        void scheduler?.consume(logicalKey);
        openItemRef.current(item);
      },
      (title) =>
        showFeedback({
          message: `提醒：${title}`,
          duration: motionDuration.feedback,
        }),
    );
    adapter.armPermissionRequest();
    let registered = false;
    const delivery = new WebReminderDeliveryPort(adapter, {
      deviceId: localDeviceId,
      getItem: (itemId) => localRepository.getItem(itemId),
      accessToken: currentAccessToken,
      registerDevice: async (platform) => {
        if (registered) return;
        const token = await currentAccessToken();
        if (!token) return;
        registered = true;
        await fetch("/api/v1/devices", {
          method: "POST",
          headers: {
            authorization: ["Bearer", token].join(" "),
            "content-type": "application/json",
          },
          body: JSON.stringify({ device_id: localDeviceId(), platform }),
        }).catch(() => undefined);
      },
    });
    scheduler = new ReminderScheduler({
      repository: localRepository,
      policy,
      delivery,
      items: () => allItemsRef.current,
    });
    const engine = scheduler;
    const windowFor = () =>
      createAppReminderWindow(
        new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        runtime,
      );
    const tick = () => engine.tick(windowFor());
    reminderTickRef.current = tick;
    void tick().catch(() => undefined);
    const interval = window.setInterval(
      () => void tick().catch(() => undefined),
      15_000,
    );
    const onVisible = () => {
      if (!document.hidden) void tick().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      reminderTickRef.current = null;
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 });
  }, [currentCourseId, page]);
  useEffect(() => {
    void courseManager
      .recoverPendingCaptures()
      .then(refresh)
      .catch((cause: unknown) => setError(toUserMessage(cause)));
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
        setSyncStatus,
      ),
    [refresh],
  );
  useEffect(
    () => () => {
      for (const timer of completionTimersRef.current.values())
        window.clearTimeout(timer);
      for (const timer of deletionTimersRef.current.values())
        window.clearTimeout(timer);
      for (const timer of enteringTimersRef.current.values())
        window.clearTimeout(timer);
    },
    [],
  );

  function replaceItemLocally(nextItem: Item) {
    const replace = (items: Item[]) =>
      items.map((value) => (value.id === nextItem.id ? nextItem : value));
    setOverviewItems(replace);
    setCourseItems(replace);
    setCalendarItems(replace);
    setAllItems(replace);
    if (selectedItem?.id === nextItem.id) setSelectedItem(nextItem);
  }

  function showFeedback(value: Omit<FeedbackNotice, "id">) {
    feedbackIdRef.current += 1;
    setFeedback({ ...value, id: feedbackIdRef.current });
  }

  function clearMotionTimer(
    timers: MutableRefObject<Map<string, number>>,
    itemId: string,
  ) {
    const timer = timers.current.get(itemId);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(itemId);
  }

  function markItemEntering(itemId: string) {
    clearMotionTimer(enteringTimersRef, itemId);
    setEnteringItemIds((ids) => new Set(ids).add(itemId));
    enteringTimersRef.current.set(
      itemId,
      window.setTimeout(() => {
        enteringTimersRef.current.delete(itemId);
        setEnteringItemIds((ids) => {
          const next = new Set(ids);
          next.delete(itemId);
          return next;
        });
      }, motionDuration.slow),
    );
  }

  function closeItemDetail() {
    detailRequestIdRef.current += 1;
    selectedItemIdRef.current = null;
    setSelectedItem(null);
    setSelectedRaw(null);
    setItemAssociations([]);
  }

  async function saveCapture(text: string, courseId: string | null = null) {
    try {
      const raw = await courseManager.capture(
        text,
        courseId ? "COURSE_ITEM" : "QUICK_CAPTURE",
        courseId,
      );
      if (courseId)
        showFeedback({
          message: "✓ 已记录",
          duration: motionDuration.feedback,
        });
      void courseManager
        .processClearCapture(raw.id, courseId)
        .then(refresh)
        .catch((cause: unknown) => setError(toUserMessage(cause)));
    } catch (cause) {
      setError(`记录未能保存在本机：${toUserMessage(cause)}`);
      throw cause;
    }
  }

  async function openItem(item: Item) {
    const requestId = ++detailRequestIdRef.current;
    selectedItemIdRef.current = item.id;
    setSelectedItem(item);
    setSelectedRaw(null);
    setItemAssociations([]);
    const [rawCapture, associations] = await Promise.all([
      courseManager.rawCaptureForItem(item.id),
      courseManager.itemAssociations(item.id),
    ]);
    if (detailRequestIdRef.current !== requestId) return;
    setSelectedRaw(rawCapture ?? null);
    setItemAssociations(associations);
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
      clearMotionTimer(completionTimersRef, item.id);
      setPendingMoveIds((ids) => new Set(ids).add(item.id));
      replaceItemLocally(completed);
      showFeedback({
        message: "✓ 已标记为完成",
        duration: motionDuration.feedback,
        action: async () => {
          clearMotionTimer(completionTimersRef, item.id);
          const restored = await courseManager.restoreItem(item.id);
          setPendingMoveIds((ids) => {
            const next = new Set(ids);
            next.delete(item.id);
            return next;
          });
          replaceItemLocally(restored);
          await refresh();
          markItemEntering(item.id);
        },
      });
      completionTimersRef.current.set(
        item.id,
        window.setTimeout(() => {
          completionTimersRef.current.delete(item.id);
          setPendingMoveIds((ids) => {
            const next = new Set(ids);
            next.delete(item.id);
            return next;
          });
          void refresh().then(() => markItemEntering(item.id));
        }, motionDuration.completionHold + motionDuration.medium),
      );
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function restore(item: Item) {
    try {
      const restored = await courseManager.restoreItem(item.id);
      replaceItemLocally(restored);
      await refresh();
      markItemEntering(item.id);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function remove(item: Item): Promise<boolean> {
    try {
      const deleted = await courseManager.deleteItem(item.id);
      clearMotionTimer(deletionTimersRef, item.id);
      setPendingDeleteIds((ids) => new Set(ids).add(item.id));
      showFeedback({
        message: `已删除“${item.title}”`,
        duration: motionDuration.feedback,
        action: async () => {
          clearMotionTimer(deletionTimersRef, item.id);
          setPendingDeleteIds((ids) => {
            const next = new Set(ids);
            next.delete(item.id);
            return next;
          });
          const restored = await courseManager.undoDelete(
            item.id,
            deleted.token,
          );
          replaceItemLocally(restored);
          await refresh();
          markItemEntering(item.id);
        },
      });
      deletionTimersRef.current.set(
        item.id,
        window.setTimeout(() => {
          deletionTimersRef.current.delete(item.id);
          setPendingDeleteIds((ids) => {
            const next = new Set(ids);
            next.delete(item.id);
            return next;
          });
          void refresh();
        }, motionDuration.panel),
      );
      return true;
    } catch (cause) {
      setError(toUserMessage(cause));
      return false;
    }
  }

  async function saveEdit(item: Item, fields: EditableItemFields) {
    try {
      setSelectedItem(await courseManager.updateItem(item.id, fields));
      await refresh();
    } catch (cause) {
      setError(toUserMessage(cause));
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
      setError(toUserMessage(cause));
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
    showFeedback({ message: "课程已删除", duration: 4000 });
  }

  async function deleteSemester(id: string) {
    try {
      const result = await courseManager.deleteSemester(id);
      if (selectedSemesterId === id) setSelectedSemesterId(null);
      if (activeCourse?.semester_id === id) {
        setCurrentCourseId(null);
        setSelectedItem(null);
        setShowCourseDelete(false);
      }
      await refresh();
      showFeedback({
        message: `学期已删除（${result.course_count} 门课程）`,
        duration: 4000,
      });
    } catch (cause) {
      setError(toUserMessage(cause));
      throw cause;
    }
  }

  async function editInformation(id: string, content: string) {
    try {
      await courseManager.updateCourseInformation(id, content);
      await refresh();
    } catch (cause) {
      setError(toUserMessage(cause));
      throw cause;
    }
  }

  async function deleteInformation(id: string) {
    try {
      await courseManager.deleteCourseInformation(id);
      await refresh();
    } catch (cause) {
      setError(toUserMessage(cause));
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
      setError(toUserMessage(cause));
    }
  }

  async function deletePending(captureId: string) {
    try {
      await courseManager.deleteUnresolvedCapture(captureId);
      await refresh();
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function resolveConflict(
    id: string,
    version: number,
    resolution: ConflictResolution,
  ) {
    const result = await resolveSyncConflict(id, version, resolution);
    setSyncConflicts(result.conflicts);
    retryAuthenticatedSync();
    if (result.undo)
      showFeedback({
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
    showFeedback({ message: "已重新提交当前内容", duration: 3500 });
    await refresh();
  }

  async function abandonSyncIssue(mutationId: string) {
    setSyncIssues(await abandonActionRequiredIssue(mutationId));
    showFeedback({ message: "正在恢复已同步状态", duration: 3500 });
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
  const incompleteCounts = Object.fromEntries(
    courses.map((course) => [
      course.id,
      allItems.filter(
        (item) =>
          item.course_id === course.id &&
          item.status === "INCOMPLETE" &&
          item.deleted_at === null,
      ).length,
    ]),
  );
  const activeCourseSemester = semesters.find(
    (semester) => semester.id === activeCourse?.semester_id,
  );
  const pendingQuestions = unresolved.filter(
    (capture) => !dismissedThisLaunch.has(capture.id),
  );

  function openSearch() {
    setHighlightedInformationId(null);
    setSearchOpen(true);
  }

  function openCourseFromSearch(course: Course) {
    setSearchOpen(false);
    closeItemDetail();
    setPage("courses");
    setCurrentCourseId(course.id);
    setCourseTab("items");
    setShowCourseDelete(false);
  }

  function openInformationFromSearch(entry: CourseInformation) {
    setSearchOpen(false);
    closeItemDetail();
    setPage("courses");
    setCurrentCourseId(entry.course_id);
    setCourseTab("information");
    setHighlightedInformationId(entry.id);
    setShowCourseDelete(false);
  }

  function navigate(nextPage: PrimaryPage) {
    setPage(nextPage);
    setSearchOpen(false);
    setHighlightedInformationId(null);
    closeItemDetail();
    setShowCourseDelete(false);
  }

  function openCompletedAiTask(kind: AiTaskKind) {
    if (kind === "course-import") {
      navigate("courses");
      setImportOpenSignal((value) => value + 1);
    } else if (kind === "course-commit") {
      // The commit's result is the courses themselves: land on the list.
      navigate("courses");
    } else {
      navigate("overview");
      setPendingExpanded(true);
    }
  }

  return (
    <div className="app-shell">
      <AccountControl
        online={online}
        status={syncStatus}
        attentionCount={syncConflicts.length + syncIssues.length}
        onOpenRepair={() => setRepairOpenSignal((value) => value + 1)}
        onOpenCompletedTask={openCompletedAiTask}
      />
      <AppNavigation page={page} onNavigate={navigate} onSearch={openSearch} />
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
          openSignal={repairOpenSignal}
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
          <div
            key={`overview:${selectedSemesterId ?? "current"}`}
            className="page-transition"
          >
            <header className="page-header">
              <div className="page-title-block">
                <p className="eyebrow">ITEMS</p>
                <h1>事项总览</h1>
                <p className="page-deck">
                  按课程与时间，核对还需要处理的事项。
                </p>
              </div>
              <div className="page-header-tools">
                <GlobalSearchButton onOpen={openSearch} />
                <SemesterSwitcher
                  semesters={semesters}
                  selectedId={selectedSemesterId}
                  onChange={(id) => {
                    setSelectedSemesterId(id);
                    setCurrentCourseId(null);
                  }}
                />
              </div>
            </header>
            {pendingQuestions.length > 0 && (
              <section
                className={`attention-panel ambiguity-panel ${pendingExpanded ? "expanded" : ""}`}
                aria-label="待确认的记录"
              >
                <AttentionSummary
                  eyebrow="NEEDS CONTEXT"
                  title="待确认的记录"
                  description={
                    pendingQuestions.length === 1
                      ? "这条输入需要一次语义判断。"
                      : "逐条处理，不影响继续记录。"
                  }
                  count={pendingQuestions.length}
                  expanded={pendingExpanded}
                  tone="ambiguity"
                  onToggle={() => setPendingExpanded((value) => !value)}
                />
                {pendingExpanded && (
                  <div className="attention-body ambiguity-body">
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
                  </div>
                )}
              </section>
            )}
            <ItemList
              items={overviewItems}
              courses={courses}
              pendingMoveIds={pendingMoveIds}
              pendingDeleteIds={pendingDeleteIds}
              enteringItemIds={enteringItemIds}
              selectedItemId={selectedItem?.id ?? null}
              onOpen={(item) => void openItem(item)}
              onComplete={(item) => void complete(item)}
            />
          </div>
        )}
        {!initializing && page === "courses" && (
          <div
            key={`courses:${activeCourse?.id ?? "index"}:${selectedSemesterId ?? "current"}`}
            className="page-transition"
          >
            <header
              className={`page-header ${activeCourse ? "course-page-header" : ""}`}
            >
              <div className="page-title-block">
                {activeCourse && (
                  <button
                    type="button"
                    className="back-link"
                    onClick={() => {
                      setCurrentCourseId(null);
                      setShowCourseDelete(false);
                    }}
                  >
                    <span aria-hidden="true">←</span> 全部课程
                  </button>
                )}
                <p className="eyebrow">COURSES</p>
                <h1>{activeCourse?.name ?? "课程"}</h1>
                <p className="page-deck">
                  {activeCourse
                    ? `${activeCourseSemester?.name ?? "无学期归属"} · ${incompleteCounts[activeCourse.id] ?? 0} 项未完成`
                    : "按课程查看事项，并保存长期有效的课程信息。"}
                </p>
              </div>
              <div className="page-header-tools">
                <GlobalSearchButton onOpen={openSearch} />
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
                      className="text-button danger"
                      onClick={() => setShowCourseDelete(true)}
                    >
                      删除课程
                    </button>
                  </div>
                )}
              </div>
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
                <div key={courseTab} className="course-tab-content">
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
                        pendingDeleteIds={pendingDeleteIds}
                        enteringItemIds={enteringItemIds}
                        selectedItemId={selectedItem?.id ?? null}
                        emptyLabel="这门课还没有未完成事项"
                        onOpen={(item) => void openItem(item)}
                        onComplete={(item) => void complete(item)}
                      />
                    </>
                  ) : courseTab === "information" ? (
                    <CourseInformationList
                      information={courseInformation}
                      highlightedId={highlightedInformationId}
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
                </div>
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
                incompleteCounts={incompleteCounts}
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
                onDeleteSemester={deleteSemester}
                openImportSignal={importOpenSignal}
                courseImportAvailable={Boolean(authClient)}
                onLoadPendingImports={pendingCourseImports}
                onStartImport={startCourseImport}
                onRetryImport={retryCourseImport}
                onResolveImport={resolveImportedCourse}
                onCommitImport={commitCourseImport}
                onDiscardImport={discardCourseImport}
                onImportCommitted={async () => {
                  await refresh();
                }}
              />
            )}
          </div>
        )}
        {!initializing && page === "calendar" && (
          <div key="calendar" className="page-transition">
            <header className="page-header">
              <div className="page-title-block">
                <p className="eyebrow">CALENDAR</p>
                <h1>日程</h1>
                <p className="page-deck">按时间查看同一批课程事项。</p>
              </div>
              <div className="page-header-tools">
                <GlobalSearchButton onOpen={openSearch} />
              </div>
            </header>
            <CalendarView
              items={calendarItems}
              courses={courses}
              semesters={semesters}
              semesterWeeks={semesterWeeks}
              onOpen={(item) => void openItem(item)}
            />
          </div>
        )}
      </main>
      {searchOpen && (
        <SearchSurface
          items={allItems}
          courses={courses}
          courseInformation={searchCourseInformation}
          onClose={() => setSearchOpen(false)}
          onOpenItem={(item) => {
            setSearchOpen(false);
            void openItem(item);
          }}
          onOpenCourse={openCourseFromSearch}
          onOpenInformation={openInformationFromSearch}
        />
      )}
      {!initializing && <QuickCapture onSave={(text) => saveCapture(text)} />}
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
          onClose={closeItemDetail}
          onComplete={(item) => void complete(item)}
          onRestore={(item) => void restore(item)}
          onDelete={remove}
          onSave={saveEdit}
          onAssociate={addItemAssociation}
          onRemoveAssociation={removeItemAssociation}
        />
      )}
      {feedback && (
        <TransientFeedback
          key={feedback.id}
          feedback={feedback}
          onDismiss={() => setFeedback(null)}
          onError={(cause) => setError(toUserMessage(cause))}
        />
      )}
      {error && (
        <ErrorNotice
          key={error}
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
    </div>
  );
}
