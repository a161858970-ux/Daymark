import { useState } from "react";
import type { Course, Item } from "@course-manager/domain";

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

function timeLabel(item: Item): string {
  const format = (value: string) =>
    new Date(value).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (item.occurrence_start_at && item.occurrence_end_at)
    return `发生 ${format(item.occurrence_start_at)} — ${format(item.occurrence_end_at)}`;
  if (item.occurrence_start_at)
    return `发生 ${format(item.occurrence_start_at)}`;
  if (item.start_at && item.due_at)
    return `${format(item.start_at)} — ${format(item.due_at)}`;
  if (item.due_at) return `截止 ${format(item.due_at)}`;
  if (item.start_at) return `开始 ${format(item.start_at)}`;
  return "时间未定";
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
          aria-label={`完成 ${item.title}`}
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
          {course?.name ?? "无课程"} · {timeLabel(item)}
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
  emptyLabel = "没有未完成事项",
  onOpen,
  onComplete,
}: Props) {
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
          未完成
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
            <p>{emptyLabel}</p>
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
          已完成 · {completed.length}{" "}
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
