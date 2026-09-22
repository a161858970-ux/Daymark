import { useState, type FormEvent } from "react";
import type { Semester, SemesterWeek } from "@course-manager/domain";

export type WeekFields = Pick<
  SemesterWeek,
  "week_number" | "start_date" | "end_date"
>;

interface Props {
  semester: Semester;
  weeks: SemesterWeek[];
  onReplace(values: WeekFields[]): Promise<void>;
}

export function SemesterWeekEditor({ semester, weeks, onReplace }: Props) {
  const [weekNumber, setWeekNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await onReplace([
        ...weeks.map(({ week_number, start_date, end_date }) => ({
          week_number,
          start_date,
          end_date,
        })),
        {
          week_number: Number(weekNumber),
          start_date: startDate,
          end_date: endDate,
        },
      ]);
      setWeekNumber("");
      setStartDate("");
      setEndDate("");
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function remove(id: string) {
    try {
      await onReplace(
        weeks
          .filter((week) => week.id !== id)
          .map(({ week_number, start_date, end_date }) => ({
            week_number,
            start_date,
            end_date,
          })),
      );
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <section className="semester-weeks" aria-label={`${semester.name}周次设置`}>
      <h2>{semester.name} · 周次</h2>
      <p className="section-note">
        周次仅用于日程的学期周标签；请按学校校历填写。
      </p>
      <ul className="schedule-list">
        {weeks.map((week) => (
          <li key={week.id}>
            <span>
              第{week.week_number}周 · {week.start_date} 至 {week.end_date}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void remove(week.id)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <form className="schedule-form" onSubmit={(event) => void add(event)}>
        <label>
          周次
          <input
            type="number"
            min="1"
            aria-label="学期周次"
            value={weekNumber}
            onChange={(event) => setWeekNumber(event.target.value)}
            required
          />
        </label>
        <label>
          开始日期
          <input
            type="date"
            aria-label="周次开始日期"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            aria-label="周次结束日期"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            required
          />
        </label>
        <button type="submit">添加周次</button>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
