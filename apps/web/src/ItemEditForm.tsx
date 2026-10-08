import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Course, Item } from "@daymark/domain";
import { changedItemFields } from "./itemEditDiff.js";
import { SelectField } from "./SelectField.js";
import { TimeBlock } from "./TimeBlock.js";
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
  // The row can change underneath (another device synced) while this form is
  // open; dirty state is therefore measured against the item as opened.
  const initialRef = useRef(item);
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
    const fields = changedItemFields(initialRef.current, {
      title: title.trim(),
      detail: detail.trim() || null,
      course_id: courseId || null,
      start_at: fromLocalInput(startAt),
      occurrence_start_at: fromLocalInput(occurrenceStartAt),
      occurrence_end_at: fromLocalInput(occurrenceEndAt),
      due_at: fromLocalInput(dueAt),
      reminder_level: reminderLevel,
    });
    if (Object.keys(fields).length === 0) {
      onSaved();
      return;
    }
    try {
      await onSave(item, fields);
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
          <SelectField
            value={courseId}
            onChange={setCourseId}
            label="课程"
            options={[
              { value: "", label: "无课程" },
              ...courses.map((course) => ({
                value: course.id,
                label: course.name,
              })),
            ]}
          />
        </label>
        <label>
          提醒等级
          <SelectField
            value={reminderLevel}
            onChange={(next) =>
              setReminderLevel(next as Item["reminder_level"])
            }
            label="提醒等级"
            options={[
              { value: "OFF", label: "关闭" },
              { value: "NORMAL", label: "普通" },
              { value: "HIGH", label: "高" },
            ]}
          />
        </label>
        <TimeBlock
          value={{
            startAt,
            occurrenceStartAt,
            occurrenceEndAt,
            dueAt,
          }}
          onChange={(next) => {
            setStartAt(next.startAt);
            setOccurrenceStartAt(next.occurrenceStartAt);
            setOccurrenceEndAt(next.occurrenceEndAt);
            setDueAt(next.dueAt);
          }}
        />
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
