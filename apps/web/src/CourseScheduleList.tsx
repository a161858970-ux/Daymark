import { useState, type FormEvent } from "react";
import type { CourseSchedule } from "@course-manager/domain";

export type ScheduleFields = Pick<
  CourseSchedule,
  | "weekday"
  | "start_time"
  | "end_time"
  | "week_start"
  | "week_end"
  | "classroom"
  | "stage_label"
>;

interface Props {
  schedules: CourseSchedule[];
  onReplace(values: ScheduleFields[]): Promise<void>;
}

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

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

export function CourseScheduleList({ schedules, onReplace }: Props) {
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [classroom, setClassroom] = useState("");
  const [stageLabel, setStageLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await onReplace([
        ...schedules.map(fields),
        {
          weekday,
          start_time: startTime,
          end_time: endTime,
          week_start: weekStart ? Number(weekStart) : null,
          week_end: weekEnd ? Number(weekEnd) : null,
          classroom: classroom.trim() || null,
          stage_label: stageLabel.trim() || null,
        },
      ]);
      setStartTime("");
      setEndTime("");
      setWeekStart("");
      setWeekEnd("");
      setClassroom("");
      setStageLabel("");
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function remove(id: string) {
    try {
      await onReplace(schedules.filter((value) => value.id !== id).map(fields));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <section className="schedule-section" aria-label="课程安排">
      <p className="section-note">
        课程安排只为课程提供上下文，不会成为日程事项。
      </p>
      <ul className="schedule-list">
        {schedules.map((value) => (
          <li key={value.id}>
            <span>
              <strong>{weekdays[value.weekday - 1]}</strong>{" "}
              {value.start_time.slice(0, 5)}–{value.end_time.slice(0, 5)}
              {value.week_start !== null && (
                <>
                  {" "}
                  · 第{value.week_start}
                  {value.week_end !== null &&
                  value.week_end !== value.week_start
                    ? `–${value.week_end}`
                    : ""}
                  周
                </>
              )}
              {value.classroom && <> · {value.classroom}</>}
              {value.stage_label && <> · {value.stage_label}</>}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void remove(value.id)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <form className="schedule-form" onSubmit={(event) => void add(event)}>
        <label>
          星期
          <select
            aria-label="课程安排星期"
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
          >
            {weekdays.map((name, index) => (
              <option value={index + 1} key={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始
          <input
            aria-label="课程安排开始时间"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            required
          />
        </label>
        <label>
          结束
          <input
            aria-label="课程安排结束时间"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            required
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
        <button type="submit">添加安排</button>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
