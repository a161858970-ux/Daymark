import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CalendarWeekRow, Item } from "@daymark/domain";
import { motionDuration } from "./motion.js";

interface Props {
  weeks: CalendarWeekRow[];
  items: Item[];
  mode: "month" | "week";
  today: string;
  selectedDate: string;
  onSelectDate(date: string): void;
  onOpen(item: Item): void;
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const monthSegmentLimit = 4;

export function calendarPositionSignatures(weeks: CalendarWeekRow[]) {
  const positions = new Map<string, string[]>();
  for (const week of weeks) {
    for (const segment of week.segments) {
      const values = positions.get(segment.item_id) ?? [];
      values.push(
        `${week.start_date}:${segment.start_column}-${segment.end_column}`,
      );
      positions.set(segment.item_id, values);
    }
  }
  return new Map(
    [...positions].map(([itemId, values]) => [itemId, values.join("|")]),
  );
}

export function CalendarGrid({
  weeks,
  items,
  mode,
  today,
  selectedDate,
  onSelectDate,
  onOpen,
}: Props) {
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const positions = useMemo(() => calendarPositionSignatures(weeks), [weeks]);
  const previousPositionsRef = useRef(positions);
  const relocationTimerRef = useRef<number | null>(null);
  const [relocatedItemIds, setRelocatedItemIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const previous = previousPositionsRef.current;
    previousPositionsRef.current = positions;
    const relocated = new Set<string>();
    for (const [itemId, position] of positions) {
      const priorPosition = previous.get(itemId);
      if (priorPosition && priorPosition !== position) relocated.add(itemId);
    }
    if (relocated.size === 0) return;
    if (relocationTimerRef.current !== null)
      window.clearTimeout(relocationTimerRef.current);
    setRelocatedItemIds(relocated);
    relocationTimerRef.current = window.setTimeout(() => {
      relocationTimerRef.current = null;
      setRelocatedItemIds(new Set());
    }, motionDuration.slow);
  }, [positions]);

  useEffect(
    () => () => {
      if (relocationTimerRef.current !== null)
        window.clearTimeout(relocationTimerRef.current);
    },
    [],
  );

  return (
    <div className={`calendar-grid mode-${mode}`}>
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays.map((day) => (
          <span key={day}>周{day}</span>
        ))}
      </div>
      {weeks.map((week) => {
        const segments =
          mode === "month"
            ? week.segments.slice(0, monthSegmentLimit)
            : week.segments;
        const overflow = week.segments.length - segments.length;
        return (
          <div className="calendar-week-row" key={week.start_date}>
            <div className="calendar-week-meta">
              {week.semester_week ? (
                <span>第 {week.semester_week} 周</span>
              ) : (
                <span aria-hidden="true">&nbsp;</span>
              )}
            </div>
            <div className="calendar-days">
              {week.days.map((day, index) => {
                const column = index + 1;
                const count = week.segments.filter(
                  (segment) =>
                    segment.start_column <= column &&
                    segment.end_column >= column,
                ).length;
                return (
                  <button
                    key={day.date}
                    type="button"
                    data-calendar-date={day.date}
                    className={[
                      "calendar-day",
                      day.in_visible_month ? "" : "outside",
                      selectedDate === day.date ? "selected" : "",
                      today === day.date ? "today" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`${day.date}，${count ? `${count} 项事项` : "没有事项"}${selectedDate === day.date ? "，已选择" : ""}`}
                    aria-current={today === day.date ? "date" : undefined}
                    onClick={() => onSelectDate(day.date)}
                  >
                    <time dateTime={day.date}>
                      {Number(day.date.slice(8, 10))}
                    </time>
                    <span
                      className={`calendar-day-count ${count ? "has-items" : ""}`}
                      aria-hidden="true"
                    >
                      {count > 0 && <b>{count}</b>}
                    </span>
                  </button>
                );
              })}
            </div>
            {segments.length > 0 && (
              <div className="calendar-segments">
                {segments.map((segment, index) => {
                  const item = itemById.get(segment.item_id);
                  if (!item) return null;
                  const style: CSSProperties = {
                    gridColumn: `${segment.start_column} / ${segment.end_column + 1}`,
                    gridRow: index + 1,
                  };
                  return (
                    <button
                      key={`${segment.item_id}:${week.start_date}`}
                      type="button"
                      className={[
                        "calendar-segment",
                        segment.kind.toLowerCase(),
                        segment.begins_here
                          ? "begins-here"
                          : "continues-before",
                        segment.ends_here ? "ends-here" : "continues-after",
                        item.status === "COMPLETE" ? "complete" : "",
                        relocatedItemIds.has(item.id) ? "relocated" : "",
                      ].join(" ")}
                      data-calendar-item-id={item.id}
                      style={style}
                      onClick={() => onOpen(item)}
                      title={item.title}
                      aria-label={`${item.title}${item.status === "COMPLETE" ? "，已完成" : ""}`}
                    >
                      <span
                        className="calendar-segment-status"
                        aria-hidden="true"
                      >
                        {item.status === "COMPLETE" ? "✓" : ""}
                      </span>
                      <span>{item.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {overflow > 0 && (
              <p className="calendar-week-overflow">
                另有 {overflow} 项，选择日期查看
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
