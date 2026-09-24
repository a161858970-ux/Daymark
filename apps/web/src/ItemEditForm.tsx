import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Course, Item } from "@course-manager/domain";
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
  headingId: string;
  onSave(item: Item, fields: EditableItemFields): Promise<void>;
  onSaved(): void;
  onCancel(): void;
}

export function ItemEditForm({
  item,
  courses,
  headingId,
  onSave,
  onSaved,
  onCancel,
}: Props) {
  const titleInputRef = useRef<HTMLInputElement>(null);
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
    const frame = window.requestAnimationFrame(() =>
      titleInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
      onSaved();
    } catch {
      /* parent presents the error; keep form open */
    }
  }

  return (
    <form
      className="detail-form"
      aria-label={`编辑 ${item.title}`}
      onSubmit={(event) => void save(event)}
    >
      <div className="detail-mode-heading">
        <p className="eyebrow">EDIT ITEM</p>
        <h2 id={headingId}>编辑事项</h2>
        <p>在当前详情空间中修改已保存的信息。</p>
      </div>
      <div className="detail-form-grid">
        <label className="detail-field-wide">
          事项标题
          <input
            ref={titleInputRef}
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
          开始时间
          <input
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
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
        <label className="detail-field-wide">
          补充内容
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
      </div>
      <div className="detail-actions detail-edit-actions">
        <button type="submit">保存修改</button>
        <button type="button" className="quiet-button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
