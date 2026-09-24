import { useEffect, useMemo, useState } from "react";
import {
  addCalendarDays,
  buildCalendarMonth,
  calendarItemsForDay,
} from "@course-manager/domain";
import type {
  Course,
  Item,
  Semester,
  SemesterWeek,
} from "@course-manager/domain";
import { CalendarDayView } from "./CalendarDayView.js";
import { CalendarGrid } from "./CalendarGrid.js";
import { localDate } from "./timeInputs.js";

interface Props {
  items: Item[];
  courses: Course[];
  semesters: Semester[];
  semesterWeeks: SemesterWeek[];
  onOpen(item: Item): void;
}

type CalendarMode = "month" | "week";
type MotionDirection = "backward" | "forward" | "neutral";

function monthTitle(year: number, month: number) {
  return `${year} 年 ${month} 月`;
}

function weekTitle(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(startDate)} — ${formatter.format(endDate)}`;
}

export function CalendarView({
  items,
  courses,
  semesters,
  semesterWeeks,
  onOpen,
}: Props) {
  const today = localDate();
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));
  const [mode, setMode] = useState<CalendarMode>("month");
  const [selectedDate, setSelectedDate] = useState(today);
  const [showDay, setShowDay] = useState(false);
  const [motionDirection, setMotionDirection] =
    useState<MotionDirection>("neutral");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const month = useMemo(
    () =>
      buildCalendarMonth(
        visibleMonth.year,
        visibleMonth.month,
        items,
        semesters,
        semesterWeeks,
        timeZone,
      ),
    [
      visibleMonth.year,
      visibleMonth.month,
      items,
      semesters,
      semesterWeeks,
      timeZone,
    ],
  );
  const selectedWeek =
    month.weeks.find(
      (week) =>
        week.start_date <= selectedDate && week.end_date >= selectedDate,
    ) ?? month.weeks[0]!;
  const visibleWeeks = mode === "month" ? month.weeks : [selectedWeek];
  const dayItems = calendarItemsForDay(selectedDate, items, timeZone);
  const viewKey =
    mode === "month"
      ? `month-${visibleMonth.year}-${visibleMonth.month}`
      : `week-${selectedWeek.start_date}`;
  const title =
    mode === "month"
      ? monthTitle(visibleMonth.year, visibleMonth.month)
      : weekTitle(selectedWeek.start_date, selectedWeek.end_date);

  useEffect(() => {
    if (!showDay) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector(".detail-panel"))
        return;
      event.preventDefault();
      returnToCalendar();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showDay, selectedDate]);

  function shiftMonth(delta: number) {
    const target = new Date(
      Date.UTC(visibleMonth.year, visibleMonth.month - 1 + delta, 1),
    );
    const year = target.getUTCFullYear();
    const monthNumber = target.getUTCMonth() + 1;
    setMotionDirection(delta < 0 ? "backward" : "forward");
    setVisibleMonth({ year, month: monthNumber });
    setSelectedDate(`${year}-${String(monthNumber).padStart(2, "0")}-01`);
    setShowDay(false);
  }

  function shiftWeek(delta: number) {
    const target = addCalendarDays(selectedDate, delta * 7);
    setMotionDirection(delta < 0 ? "backward" : "forward");
    setSelectedDate(target);
    setVisibleMonth({
      year: Number(target.slice(0, 4)),
      month: Number(target.slice(5, 7)),
    });
    setShowDay(false);
  }

  function move(delta: number) {
    if (mode === "month") shiftMonth(delta);
    else shiftWeek(delta);
  }

  function goToday() {
    setMotionDirection("neutral");
    setSelectedDate(today);
    setVisibleMonth({
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7)),
    });
    setShowDay(false);
  }

  function selectMode(nextMode: CalendarMode) {
    setMode(nextMode);
    setMotionDirection("neutral");
    setShowDay(false);
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    setShowDay(true);
  }

  function returnToCalendar() {
    setShowDay(false);
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-calendar-date="${selectedDate}"]`)
        ?.focus(),
    );
  }

  return (
    <section
      className={`calendar-view mode-${mode} ${showDay ? "day-open" : ""}`}
      aria-label="事项日程"
    >
      <div className="calendar-toolbar">
        <div className="calendar-title-block" aria-live="polite">
          <p className="calendar-context">
            当前学期：{month.semester?.name ?? "无"}
          </p>
          <strong>{title}</strong>
        </div>
        <div className="calendar-toolbar-actions">
          <button type="button" className="calendar-today" onClick={goToday}>
            今天
          </button>
          <div className="calendar-navigation" aria-label="切换日程范围">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label={mode === "month" ? "上个月" : "上一周"}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label={mode === "month" ? "下个月" : "下一周"}
            >
              ›
            </button>
          </div>
          <div
            className="calendar-mode-switch"
            role="tablist"
            aria-label="日程视图"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "month"}
              className={mode === "month" ? "selected" : ""}
              onClick={() => selectMode("month")}
            >
              月
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "week"}
              className={mode === "week" ? "selected" : ""}
              onClick={() => selectMode("week")}
            >
              周
            </button>
          </div>
        </div>
      </div>
      <div
        key={viewKey}
        className={`calendar-grid-transition ${motionDirection}`}
      >
        <CalendarGrid
          weeks={visibleWeeks}
          items={items}
          mode={mode}
          today={today}
          selectedDate={selectedDate}
          onSelectDate={selectDate}
          onOpen={onOpen}
        />
      </div>
      {showDay && (
        <CalendarDayView
          date={selectedDate}
          items={dayItems}
          courses={courses}
          timeZone={timeZone}
          onOpen={onOpen}
          onBack={returnToCalendar}
        />
      )}
    </section>
  );
}
