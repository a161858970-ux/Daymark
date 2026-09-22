import { useMemo, useState, type CSSProperties } from "react";
import {
  buildCalendarMonth,
  calendarItemsForDay,
  addCalendarDays,
} from "@course-manager/domain";
import type {
  CalendarWeekRow,
  Item,
  Semester,
  SemesterWeek,
} from "@course-manager/domain";
import { localDate } from "./timeInputs.js";

interface Props {
  items: Item[];
  semesters: Semester[];
  semesterWeeks: SemesterWeek[];
  onOpen(item: Item): void;
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarView({
  items,
  semesters,
  semesterWeeks,
  onOpen,
}: Props) {
  const today = localDate();
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));
  const [mode, setMode] = useState<"month" | "week">("month");
  const [selectedDate, setSelectedDate] = useState(today);
  const [showDay, setShowDay] = useState(false);
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
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const visibleWeeks =
    mode === "month"
      ? month.weeks
      : [
          month.weeks.find(
            (week) =>
              week.start_date <= selectedDate && week.end_date >= selectedDate,
          ) ?? month.weeks[0]!,
        ];
  const dayItems = calendarItemsForDay(selectedDate, items, timeZone);

  function shiftMonth(delta: number) {
    const target = new Date(
      Date.UTC(visibleMonth.year, visibleMonth.month - 1 + delta, 1),
    );
    const year = target.getUTCFullYear();
    const monthNumber = target.getUTCMonth() + 1;
    setVisibleMonth({ year, month: monthNumber });
    setSelectedDate(`${year}-${String(monthNumber).padStart(2, "0")}-01`);
    setShowDay(false);
  }

  function shiftWeek(delta: number) {
    const target = addCalendarDays(selectedDate, delta * 7);
    setSelectedDate(target);
    setVisibleMonth({
      year: Number(target.slice(0, 4)),
      month: Number(target.slice(5, 7)),
    });
    setShowDay(false);
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    setShowDay(true);
  }

  function WeekRow({ week }: { week: CalendarWeekRow }) {
    return (
      <div className="calendar-week-row">
        <div className="calendar-week-meta">
          {week.semester_week ? `第 ${week.semester_week} 周` : ""}
        </div>
        <div className="calendar-days">
          {week.days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={[
                "calendar-day",
                day.in_visible_month ? "" : "outside",
                selectedDate === day.date ? "selected" : "",
              ].join(" ")}
              onClick={() => selectDate(day.date)}
              aria-label={`${day.date} 的事项`}
            >
              <span>{Number(day.date.slice(8, 10))}</span>
            </button>
          ))}
        </div>
        {week.segments.length > 0 && (
          <div className="calendar-segments">
            {week.segments.map((segment, index) => {
              const item = itemById.get(segment.item_id);
              if (!item) return null;
              const style: CSSProperties = {
                gridColumn: `${segment.start_column} / ${segment.end_column + 1}`,
                gridRow: index + 1,
              };
              return (
                <button
                  key={`${segment.item_id}:${index}`}
                  type="button"
                  className={`calendar-segment ${segment.kind.toLowerCase()} ${item.status === "COMPLETE" ? "complete" : ""}`}
                  style={style}
                  onClick={() => onOpen(item)}
                  title={item.title}
                >
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      className={`calendar-view ${showDay ? "day-open" : ""}`}
      aria-label="事项日程"
    >
      <div className="calendar-toolbar">
        <div>
          <p className="calendar-context">
            当前学期：{month.semester?.name ?? "无"}
          </p>
          <strong>
            {visibleMonth.year} 年 {visibleMonth.month} 月
          </strong>
        </div>
        <div className="calendar-controls">
          {mode === "week" && (
            <button
              type="button"
              onClick={() => shiftWeek(-1)}
              aria-label="上一周"
            >
              ←
            </button>
          )}
          {mode === "week" && (
            <button
              type="button"
              onClick={() => shiftWeek(1)}
              aria-label="下一周"
            >
              →
            </button>
          )}
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="上个月"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="下个月"
          >
            ›
          </button>
          <button
            type="button"
            className={mode === "month" ? "selected" : ""}
            onClick={() => {
              setMode("month");
              setShowDay(false);
            }}
          >
            月
          </button>
          <button
            type="button"
            className={mode === "week" ? "selected" : ""}
            onClick={() => {
              setMode("week");
              setShowDay(false);
            }}
          >
            周
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((day) => (
            <span key={day}>周{day}</span>
          ))}
        </div>
        {visibleWeeks.map((week) => (
          <WeekRow key={week.start_date} week={week} />
        ))}
      </div>
      {showDay && (
        <section
          className="calendar-day-detail"
          aria-label={`${selectedDate} 的事项`}
        >
          <div className="calendar-day-heading">
            <h2>{selectedDate}</h2>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setShowDay(false)}
            >
              返回日程
            </button>
          </div>
          {dayItems.length === 0 && (
            <p className="empty-state">这一天没有已记录的有时间事项。</p>
          )}
          {dayItems.length > 0 && (
            <ul>
              {dayItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className={item.status === "COMPLETE" ? "complete" : ""}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
