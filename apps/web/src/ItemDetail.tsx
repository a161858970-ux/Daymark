import { useEffect, useState, type FormEvent } from "react";
import type { Course, Item, RawCapture } from "@course-manager/domain";
import { fromLocalInput, toLocalInput } from "./timeInputs.js";

export type EditableItemFields = Partial<
  Pick<
    Item,
    | "title"
    | "detail"
    | "course_id"
    | "start_at"
    | "occurrence_start_at"
    | "occurrence_end_at"
    | "due_at"
    | "reminder_level"
  >
>;

interface Props {
  item: Item;
  courses: Course[];
  rawCapture: RawCapture | null;
  onClose(): void;
  onComplete(item: Item): void;
  onRestore(item: Item): void;
  onDelete(item: Item): void;
  onSave(item: Item, fields: EditableItemFields): Promise<void>;
}

export function ItemDetail({
  item,
  courses,
  rawCapture,
  onClose,
  onComplete,
  onRestore,
  onDelete,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [courseId, setCourseId] = useState(item.course_id ?? "");
  const [startAt, setStartAt] = useState(toLocalInput(item.start_at));
  const [occurrenceStartAt, setOccurrenceStartAt] = useState(
    toLocalInput(item.occurrence_start_at),
  );
  const [occurrenceEndAt, setOccurrenceEndAt] = useState(
    toLocalInput(item.occurrence_end_at),
  );
  const [dueAt, setDueAt] = useState(toLocalInput(item.due_at));
  const [reminderLevel, setReminderLevel] = useState<Item["reminder_level"]>(
    item.reminder_level,
  );
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setShowRaw(false);
    setTitle(item.title);
    setDetail(item.detail ?? "");
    setCourseId(item.course_id ?? "");
    setStartAt(toLocalInput(item.start_at));
    setOccurrenceStartAt(toLocalInput(item.occurrence_start_at));
    setOccurrenceEndAt(toLocalInput(item.occurrence_end_at));
    setDueAt(toLocalInput(item.due_at));
    setReminderLevel(item.reminder_level);
  }, [item.id]);
  const course = courses.find((value) => value.id === item.course_id);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await onSave(item, {
        title: title.trim(),
        detail: detail.trim() || null,
        course_id: courseId || null,
        start_at: fromLocalInput(startAt),
        occurrence_start_at: fromLocalInput(occurrenceStartAt),
        occurrence_end_at: fromLocalInput(occurrenceEndAt),
        due_at: fromLocalInput(dueAt),
        reminder_level: reminderLevel,
      });
      setEditing(false);
    } catch {
      /* parent presents the error; keep form open */
    }
  }

  return (
    <>
      <button
        type="button"
        className="detail-backdrop"
        aria-label="关闭事项详情"
        onClick={onClose}
      />
      <aside className="detail-panel" aria-label="事项详情">
        <div className="detail-top">
          <span>事项详情</span>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {editing ? (
          <form onSubmit={(event) => void save(event)}>
            <label>
              事项标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <label>
              课程
              <select
                value={courseId}
                onChange={(event) => setCourseId(event.target.value)}
              >
                <option value="">无课程</option>
                {courses.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              开始时间
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label>
              发生开始
              <input
                type="datetime-local"
                value={occurrenceStartAt}
                onChange={(event) => setOccurrenceStartAt(event.target.value)}
              />
            </label>
            <label>
              发生结束
              <input
                type="datetime-local"
                value={occurrenceEndAt}
                onChange={(event) => setOccurrenceEndAt(event.target.value)}
              />
            </label>
            <label>
              截止时间
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
            <label>
              提醒等级
              <select
                value={reminderLevel}
                onChange={(event) =>
                  setReminderLevel(event.target.value as Item["reminder_level"])
                }
              >
                <option value="OFF">关闭</option>
                <option value="NORMAL">普通</option>
                <option value="HIGH">高</option>
              </select>
            </label>
            <label>
              补充内容
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
              />
            </label>
            <div className="detail-actions">
              <button type="submit">保存</button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2>{item.title}</h2>
            <p className="detail-meta">
              {course?.name ?? "无课程"} ·{" "}
              {item.status === "COMPLETE" ? "已完成" : "未完成"}
            </p>
            {!item.start_at &&
              !item.occurrence_start_at &&
              !item.occurrence_end_at &&
              !item.due_at && <p className="detail-meta">时间未定</p>}
            {item.start_at && (
              <p className="detail-meta">
                开始 · {new Date(item.start_at).toLocaleString("zh-CN")}
              </p>
            )}
            {item.occurrence_start_at && (
              <p className="detail-meta">
                发生 ·{" "}
                {new Date(item.occurrence_start_at).toLocaleString("zh-CN")}
                {item.occurrence_end_at
                  ? ` — ${new Date(item.occurrence_end_at).toLocaleString("zh-CN")}`
                  : ""}
              </p>
            )}
            {item.due_at && (
              <p className="detail-meta">
                截止 · {new Date(item.due_at).toLocaleString("zh-CN")}
              </p>
            )}
            <p className="detail-meta">
              提醒 ·{" "}
              {{ OFF: "关闭", NORMAL: "普通", HIGH: "高" }[item.reminder_level]}
            </p>
            {item.detail && <p className="detail-content">{item.detail}</p>}
            <div className="detail-actions">
              {item.status === "INCOMPLETE" ? (
                <button type="button" onClick={() => onComplete(item)}>
                  完成事项
                </button>
              ) : (
                <button type="button" onClick={() => onRestore(item)}>
                  恢复未完成
                </button>
              )}
              <button
                type="button"
                className="quiet-button"
                onClick={() => setEditing(true)}
              >
                编辑
              </button>
            </div>
            {rawCapture && (
              <div className="raw-capture">
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={showRaw}
                  onClick={() => setShowRaw(!showRaw)}
                >
                  原始记录 {showRaw ? "⌃" : "⌄"}
                </button>
                {showRaw && <p>{rawCapture.raw_text}</p>}
              </div>
            )}
            <div className="danger-zone">
              {!confirmDelete ? (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  删除事项
                </button>
              ) : (
                <div role="alertdialog" aria-label="确认删除事项">
                  <p>删除“{item.title}”？</p>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDelete(item)}
                  >
                    确认删除
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
