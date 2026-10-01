import { useState, type FormEvent } from "react";
import type { CourseSchedule } from "@course-manager/domain";
import { DateTimeField } from "./DateTimeField.js";
import { SelectField } from "./SelectField.js";
import { toUserMessage } from "./errors.js";
import {
  scheduleSummary,
  summaryParts,
  weekdays,
  type ScheduleFields,
} from "./scheduleSummary.js";

export type { ScheduleFields };

interface Props {
  schedules: CourseSchedule[];
  onReplace(values: ScheduleFields[]): Promise<void>;
}

function fields(value: CourseSchedule): ScheduleFields {
  return {
    weekday: value.weekday,
    start_time: value.start_time,
    end_time: value.end_time,
    week_start: value.week_start,
    week_end: value.week_end,
    classroom: value.classroom,
    stage_label: value.stage_label,
  };
}

/**
 * The whole schedule set is replaced in one command (spec 16 §9 — suitable
 * for manual correction), so an edit is expressed as "same list, one entry
 * swapped". Adding appends; a stale editing id falls back to appending so a
 * click can never silently drop an entry.
 */
export function buildScheduleReplace(
  schedules: CourseSchedule[],
  editingId: string | null,
  entry: ScheduleFields,
): ScheduleFields[] {
  const editing =
    editingId !== null && schedules.some((value) => value.id === editingId);
  if (!editing) return [...schedules.map(fields), entry];
  return schedules.map((value) =>
    fields(value.id === editingId ? { ...value, ...entry } : value),
  );
}

export function CourseScheduleList({ schedules, onReplace }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [classroom, setClassroom] = useState("");
  const [stageLabel, setStageLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const editing = editingId
    ? (schedules.find((value) => value.id === editingId) ?? null)
    : null;

  function resetForm() {
    setEditingId(null);
    setWeekday(1);
    setStartTime("");
    setEndTime("");
    setWeekStart("");
    setWeekEnd("");
    setClassroom("");
    setStageLabel("");
    setError(null);
  }

  function startEdit(value: CourseSchedule) {
    setEditingId(value.id);
    setWeekday(value.weekday);
    setStartTime(value.start_time);
    setEndTime(value.end_time);
    setWeekStart(value.week_start === null ? "" : String(value.week_start));
    setWeekEnd(value.week_end === null ? "" : String(value.week_end));
    setClassroom(value.classroom ?? "");
    setStageLabel(value.stage_label ?? "");
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onReplace(
        buildScheduleReplace(schedules, editingId, {
          weekday,
          start_time: startTime,
          end_time: endTime,
          week_start: weekStart ? Number(weekStart) : null,
          week_end: weekEnd ? Number(weekEnd) : null,
          classroom: classroom.trim() || null,
          stage_label: stageLabel.trim() || null,
        }),
      );
      resetForm();
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  async function remove(id: string) {
    try {
      await onReplace(schedules.filter((value) => value.id !== id).map(fields));
      if (editingId === id) resetForm();
      else setError(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    }
  }

  return (
    <section className="schedule-section" aria-label="课程安排">
      <p className="section-note">
        课程安排只为课程提供上下文，不会成为日程事项。
      </p>
      <ul className="schedule-list">
        {schedules.map((value) => (
          <li
            key={value.id}
            className={value.id === editingId ? "is-editing" : undefined}
          >
            <span>
              <strong>{summaryParts(fields(value)).weekday}</strong>{" "}
              {summaryParts(fields(value)).rest}
            </span>
            <span className="row-actions">
              <button
                type="button"
                className="quiet-button"
                aria-label={`编辑 ${scheduleSummary(fields(value))}`}
                onClick={() => startEdit(value)}
              >
                编辑
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => void remove(value.id)}
              >
                移除
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form className="schedule-form" onSubmit={(event) => void submit(event)}>
        {editing && (
          <p className="schedule-editing-note">
            正在修改：{scheduleSummary(fields(editing))}
          </p>
        )}
        <label>
          星期
          <SelectField
            value={String(weekday)}
            onChange={(next) => setWeekday(Number(next))}
            ariaLabel="课程安排星期"
            label="星期"
            options={weekdays.map((name, index) => ({
              value: String(index + 1),
              label: name,
            }))}
          />
        </label>
        <label>
          开始
          <DateTimeField
            mode="time"
            label="课程安排开始时间"
            ariaLabel="课程安排开始时间"
            required
            value={startTime}
            onChange={setStartTime}
          />
        </label>
        <label>
          结束
          <DateTimeField
            mode="time"
            label="课程安排结束时间"
            ariaLabel="课程安排结束时间"
            required
            value={endTime}
            onChange={setEndTime}
          />
        </label>
        <label>
          起始周
          <input
            aria-label="课程安排起始周"
            type="number"
            min="1"
            value={weekStart}
            onChange={(event) => setWeekStart(event.target.value)}
          />
        </label>
        <label>
          结束周
          <input
            aria-label="课程安排结束周"
            type="number"
            min="1"
            value={weekEnd}
            onChange={(event) => setWeekEnd(event.target.value)}
          />
        </label>
        <label>
          地点
          <input
            aria-label="课程安排地点"
            value={classroom}
            onChange={(event) => setClassroom(event.target.value)}
          />
        </label>
        <label>
          阶段
          <input
            aria-label="课程安排阶段"
            value={stageLabel}
            onChange={(event) => setStageLabel(event.target.value)}
          />
        </label>
        <button type="submit">{editing ? "保存修改" : "添加安排"}</button>
        {editing && (
          <button type="button" className="quiet-button" onClick={resetForm}>
            取消
          </button>
        )}
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
