import type { Course, Item } from "@daymark/domain";
import { localDateOfInstant } from "@daymark/domain";

interface Props {
  date: string;
  items: Item[];
  courses: Course[];
  timeZone: string;
  onOpen(item: Item): void;
  onBack(): void;
}

function formatClock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatShortDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function rangeTimeLabel(
  start: string,
  end: string,
  date: string,
  timeZone: string,
) {
  const startDate = localDateOfInstant(start, timeZone);
  const endDate = localDateOfInstant(end, timeZone);
  if (startDate === endDate)
    return `${formatClock(start, timeZone)} — ${formatClock(end, timeZone)}`;
  if (date === startDate)
    return `${formatClock(start, timeZone)} 开始 · 至 ${formatShortDate(end, timeZone)}`;
  if (date === endDate) return `持续事项 · ${formatClock(end, timeZone)} 结束`;
  return `${formatShortDate(start, timeZone)} — ${formatShortDate(end, timeZone)} · 持续事项`;
}

export function calendarItemTimeLabel(
  item: Item,
  date: string,
  timeZone: string,
) {
  if (item.occurrence_start_at && item.occurrence_end_at)
    return rangeTimeLabel(
      item.occurrence_start_at,
      item.occurrence_end_at,
      date,
      timeZone,
    );
  if (item.start_at && item.due_at)
    return rangeTimeLabel(item.start_at, item.due_at, date, timeZone);
  if (item.occurrence_start_at)
    return `发生 ${formatClock(item.occurrence_start_at, timeZone)}`;
  if (item.due_at) return `截止 ${formatClock(item.due_at, timeZone)}`;
  if (item.start_at) return `开始 ${formatClock(item.start_at, timeZone)}`;
  if (item.occurrence_end_at)
    return `发生结束 ${formatClock(item.occurrence_end_at, timeZone)}`;
  return "";
}

export function calendarDayHeading(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const calendarDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(value);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    weekday: "long",
  }).format(value);
  return `${calendarDate} · ${weekday}`;
}

export function CalendarDayView({
  date,
  items,
  courses,
  timeZone,
  onOpen,
  onBack,
}: Props) {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  return (
    <section className="calendar-day-detail" aria-label={`${date} 的事项`}>
      <div className="calendar-day-heading">
        <div>
          <p className="eyebrow">SINGLE DAY</p>
          <h2>{calendarDayHeading(date)}</h2>
        </div>
        <button type="button" className="quiet-button" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回日程
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty-state calendar-day-empty">
          <span aria-hidden="true">○</span>
          <p>这一天没有已记录的有时间事项。</p>
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              className={item.status === "COMPLETE" ? "complete" : ""}
            >
              <span className="calendar-day-status" aria-hidden="true">
                {item.status === "COMPLETE" ? "✓" : "○"}
              </span>
              <button type="button" onClick={() => onOpen(item)}>
                <time>{calendarItemTimeLabel(item, date, timeZone)}</time>
                <strong>{item.title}</strong>
                <small>
                  {item.course_id
                    ? (courseById.get(item.course_id)?.name ?? "课程已移除")
                    : "无课程"}
                  {item.status === "COMPLETE" ? " · 已完成" : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
