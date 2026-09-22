import { useState } from "react";
import type { Course, Item } from "@course-manager/domain";

interface Props {
  items: Item[];
  courses: Course[];
  pendingMoveIds: Set<string>;
  onOpen(item: Item): void;
  onComplete(item: Item): void;
}

function timeLabel(item: Item): string {
  const time =
    item.due_at ??
    item.occurrence_start_at ??
    item.start_at ??
    item.occurrence_end_at;
  return time
    ? new Date(time).toLocaleString("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "时间未定";
}

function Row({
  item,
  courses,
  leaving,
  onOpen,
  onComplete,
}: {
  item: Item;
  courses: Course[];
  leaving: boolean;
  onOpen: (item: Item) => void;
  onComplete: (item: Item) => void;
}) {
  const course = courses.find((value) => value.id === item.course_id);
  return (
    <li
      className={`item-row ${item.status === "COMPLETE" ? "completed" : ""} ${leaving ? "leaving" : ""}`}
    >
      {item.status === "INCOMPLETE" || leaving ? (
        <button
          className="completion-target"
          type="button"
          aria-label={`完成 ${item.title}`}
          onClick={() => onComplete(item)}
        >
          <span>{item.status === "COMPLETE" ? "✓" : "○"}</span>
        </button>
      ) : (
        <span className="completion-target checked" aria-hidden="true">
          ✓
        </span>
      )}
      <button className="item-body" type="button" onClick={() => onOpen(item)}>
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
                onOpen={onOpen}
                onComplete={onComplete}
              />
            ))}
          </ul>
        ) : (
          <p className="empty-state">没有未完成事项</p>
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
          <span aria-hidden="true">{completedOpen ? "⌃" : "⌄"}</span>
        </button>
        {completedOpen && (
          <ul>
            {completed.map((item) => (
              <Row
                key={item.id}
                item={item}
                courses={courses}
                leaving={false}
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
