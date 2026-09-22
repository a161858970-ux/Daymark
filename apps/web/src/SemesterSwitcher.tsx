import type { Semester } from "@course-manager/domain";

interface Props {
  semesters: Semester[];
  selectedId: string | null;
  onChange(id: string | null): void;
}

export function SemesterSwitcher({ semesters, selectedId, onChange }: Props) {
  if (semesters.length === 0) return null;
  return (
    <label className="semester-switcher">
      学期视角
      <select
        value={selectedId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">当前</option>
        {semesters.map((semester) => (
          <option key={semester.id} value={semester.id}>
            {semester.name}
          </option>
        ))}
      </select>
    </label>
  );
}
