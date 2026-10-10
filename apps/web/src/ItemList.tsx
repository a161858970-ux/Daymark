import { useState } from "react";
import type { Course, Item } from "@daymark/domain";
import { useI18n, type Translate } from "./i18n/index.js";

interface Props {
  items: Item[];
  courses: Course[];
  pendingMoveIds: Set<string>;
  pendingDeleteIds?: Set<string>;
  enteringItemIds?: Set<string>;
  selectedItemId?: string | null;
  emptyLabel?: string;
  onOpen(item: Item): void;
  onComplete(item: Item): void;
}

function timeLabel(
  item: Item,
  t: Translate,
  formatDateTime: (value: string) => string,
  formatDate: (value: string) => string,
): string {
  if (item.occurrence_start_date || item.occurrence_end_date) {
    const start = item.occurrence_start_date ?? item.occurrence_end_date!;
    const end = item.occurrence_end_date ?? start;
    return start === end
      ? t("item.tagOccur", { value: formatDate(start) })
      : t("item.tagOccurSpan", {
          start: formatDate(start),
          end: formatDate(end),
        });
  }
  if (item.occurrence_start_at && item.occurrence_end_at)
    return t("item.tagOccurSpan", {
      start: formatDateTime(item.occurrence_start_at),
      end: formatDateTime(item.occurrence_end_at),
    });
  if (item.occurrence_start_at)
    return t("item.tagOccur", {
      value: formatDateTime(item.occurrence_start_at),
    });
  if (item.start_date && item.due_date)
    return t("item.tagRange", {
      start: formatDate(item.start_date),
      end: formatDate(item.due_date),
    });
  if (item.start_at && item.due_at)
    return t("item.tagRange", {
      start: formatDateTime(item.start_at),
      end: formatDateTime(item.due_at),
    });
  if (item.due_date)
    return t("item.tagDue", { value: formatDate(item.due_date) });
  if (item.due_at)
    return t("item.tagDue", { value: formatDateTime(item.due_at) });
  if (item.start_date)
    return t("item.tagStart", { value: formatDate(item.start_date) });
  if (item.start_at)
    return t("item.tagStart", { value: formatDateTime(item.start_at) });
  return t("item.timeUnset");
}

function Row({
  item,
  courses,
  leaving,
  deleting,
  entering,
  selected,
  onOpen,
  onComplete,
}: {
  item: Item;
  courses: Course[];
  leaving: boolean;
  deleting: boolean;
  entering: boolean;
  selected: boolean;
  onOpen: (item: Item) => void;
  onComplete: (item: Item) => void;
}) {
  const { t, formatItemDateTime, formatItemDateOnly } = useI18n();
  const course = courses.find((value) => value.id === item.course_id);
  return (
    <li
      data-item-row-id={item.id}
      className={[
        "item-row",
        item.status === "COMPLETE" ? "completed" : "",
        leaving ? "leaving" : "",
        deleting ? "deleting" : "",
        entering ? "entering" : "",
        selected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {item.status === "INCOMPLETE" || leaving ? (
        <button
          className="completion-target"
          type="button"
          aria-label={t("item.completeAria", { title: item.title })}
          disabled={deleting}
          onClick={() => onComplete(item)}
        >
          <span className="completion-indicator">
            {item.status === "COMPLETE" ? "✓" : ""}
          </span>
        </button>
      ) : (
        <span className="completion-target checked" aria-hidden="true">
          <span className="completion-indicator">✓</span>
        </span>
      )}
      <button
        className="item-body"
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={deleting}
        onClick={() => onOpen(item)}
      >
        <span className="item-title">{item.title}</span>
        <span className="item-meta">
          {course?.name ?? t("item.noCourse")} ·{" "}
          {timeLabel(item, t, formatItemDateTime, formatItemDateOnly)}
        </span>
      </button>
    </li>
  );
}

export function ItemList({
  items,
  courses,
  pendingMoveIds,
  pendingDeleteIds = new Set(),
  enteringItemIds = new Set(),
  selectedItemId = null,
  emptyLabel,
  onOpen,
  onComplete,
}: Props) {
  const t = useI18n().t;
  const [completedOpen, setCompletedOpen] = useState(false);
  const incomplete = items.filter(
    (item) => item.status === "INCOMPLETE" || pendingMoveIds.has(item.id),
  );
  const completed = items.filter(
    (item) => item.status === "COMPLETE" && !pendingMoveIds.has(item.id),
  );
  return (
    <div className="item-list">
      <section aria-labelledby="incomplete-heading">
        <h2 id="incomplete-heading" className="section-heading">
          {t("item.sectionIncomplete")}
        </h2>
        {incomplete.length ? (
          <ul>
            {incomplete.map((item) => (
              <Row
                key={item.id}
                item={item}
                courses={courses}
                leaving={pendingMoveIds.has(item.id)}
                deleting={pendingDeleteIds.has(item.id)}
                entering={enteringItemIds.has(item.id)}
                selected={selectedItemId === item.id}
                onOpen={onOpen}
                onComplete={onComplete}
              />
            ))}
          </ul>
        ) : (
          <div className="empty-state item-empty-state">
            <span aria-hidden="true">○</span>
            <p>{emptyLabel ?? t("item.emptyIncomplete")}</p>
          </div>
        )}
      </section>
      <section aria-labelledby="completed-heading">
        <button
          id="completed-heading"
          className="section-heading section-toggle"
          type="button"
          aria-expanded={completedOpen}
          onClick={() => setCompletedOpen(!completedOpen)}
        >
          {t("item.sectionCompleted", { count: completed.length })}{" "}
          <span
            className={`section-chevron ${completedOpen ? "open" : ""}`}
            aria-hidden="true"
          />
        </button>
        {completedOpen && (
          <ul className="completed-list-reveal">
            {completed.map((item) => (
              <Row
                key={item.id}
                item={item}
                courses={courses}
                leaving={false}
                deleting={pendingDeleteIds.has(item.id)}
                entering={enteringItemIds.has(item.id)}
                selected={selectedItemId === item.id}
                onOpen={onOpen}
                onComplete={onComplete}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
