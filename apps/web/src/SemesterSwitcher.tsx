import type { Semester } from "@daymark/domain";
import { SelectField } from "./SelectField.js";

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
      <SelectField
        value={selectedId ?? ""}
        onChange={(next) => onChange(next || null)}
        label="学期视角"
        options={[
          { value: "", label: "当前" },
          ...semesters.map((semester) => ({
            value: semester.id,
            label: semester.name,
          })),
        ]}
      />
    </label>
  );
}
