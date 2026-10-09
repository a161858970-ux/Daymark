import type { Course, Item } from "@daymark/domain";
import { localDateOfInstant } from "@daymark/domain";
import {
  formatMonthDay,
  formatTime,
  formatWeekday,
  getMessage,
  useI18n,
  type Locale,
} from "./i18n/index.js";

interface Props {
  date: string;
  items: Item[];
  courses: Course[];
  timeZone: string;
  onOpen(item: Item): void;
  onBack(): void;
}

function formatClock(value: string, timeZone: string, locale: Locale) {
  return formatTime(new Date(value), locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatShortDate(value: string, timeZone: string, locale: Locale) {
  return formatTime(new Date(value), locale, {
    timeZone,
    month: "numeric",
    day: "numeric",
  });
}

function rangeTimeLabel(
  start: string,
  end: string,
  date: string,
  timeZone: string,
  locale: Locale,
) {
  const startDate = localDateOfInstant(start, timeZone);
  const endDate = localDateOfInstant(end, timeZone);
  if (startDate === endDate)
    return getMessage(locale, "calendar.timeRange", {
      start: formatClock(start, timeZone, locale),
      end: formatClock(end, timeZone, locale),
    });
  if (date === startDate)
    return getMessage(locale, "calendar.allDayRange", {
      start: formatClock(start, timeZone, locale),
      end: formatShortDate(end, timeZone, locale),
    });
  if (date === endDate)
    return getMessage(locale, "calendar.multiDay", {
      end: formatClock(end, timeZone, locale),
    });
  return getMessage(locale, "calendar.rangeLabel", {
    from: formatShortDate(start, timeZone, locale),
    end: formatShortDate(end, timeZone, locale),
  });
}

export function calendarItemTimeLabel(
  item: Item,
  date: string,
  timeZone: string,
  locale: Locale,
) {
  if (item.occurrence_start_at && item.occurrence_end_at)
    return rangeTimeLabel(
      item.occurrence_start_at,
      item.occurrence_end_at,
      date,
      timeZone,
      locale,
    );
  if (item.start_at && item.due_at)
    return rangeTimeLabel(item.start_at, item.due_at, date, timeZone, locale);
  if (item.occurrence_start_at)
    return getMessage(locale, "calendar.occurrenceAt", {
      time: formatClock(item.occurrence_start_at, timeZone, locale),
    });
  if (item.due_at)
    return getMessage(locale, "calendar.dueAt", {
      time: formatClock(item.due_at, timeZone, locale),
    });
  if (item.start_at)
    return getMessage(locale, "calendar.startAt", {
      time: formatClock(item.start_at, timeZone, locale),
    });
  if (item.occurrence_end_at)
    return getMessage(locale, "calendar.occurrenceEndAt", {
      time: formatClock(item.occurrence_end_at, timeZone, locale),
    });
  return "";
}

export function calendarDayHeading(date: string, locale: Locale) {
  // Noon UTC keeps the calendar date stable across local time zones.
  const value = new Date(`${date}T12:00:00Z`);
  return getMessage(locale, "calendar.dayHeading", {
    date: formatMonthDay(value, locale),
    weekday: formatWeekday(value, locale, { weekday: "long" }),
  });
}

export function CalendarDayView({
  date,
  items,
  courses,
  timeZone,
  onOpen,
  onBack,
}: Props) {
  const { t, locale } = useI18n();
  const courseById = new Map(courses.map((course) => [course.id, course]));
  return (
    <section
      className="calendar-day-detail"
      aria-label={t("calendar.dayItems", { date })}
    >
      <div className="calendar-day-heading">
        <div>
          <p className="eyebrow">SINGLE DAY</p>
          <h2>{calendarDayHeading(date, locale)}</h2>
        </div>
        <button type="button" className="quiet-button" onClick={onBack}>
          {t("calendar.backToCalendar")}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty-state calendar-day-empty">
          <span aria-hidden="true">○</span>
          <p>{t("calendar.emptyDay")}</p>
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
                <time>
                  {calendarItemTimeLabel(item, date, timeZone, locale)}
                </time>
                <strong>{item.title}</strong>
                <small>
                  {item.course_id
                    ? (courseById.get(item.course_id)?.name ??
                      t("calendar.courseRemoved"))
                    : t("item.noCourse")}
                  {item.status === "COMPLETE"
                    ? t("calendar.completedSuffix")
                    : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
