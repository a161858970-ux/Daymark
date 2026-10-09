import type { Semester } from "@daymark/domain";
import { SelectField } from "./SelectField.js";
import { useT } from "./i18n/index.js";

interface Props {
  semesters: Semester[];
  selectedId: string | null;
  onChange(id: string | null): void;
}

export function SemesterSwitcher({ semesters, selectedId, onChange }: Props) {
  const t = useT();
  if (semesters.length === 0) return null;
  return (
    <label className="semester-switcher">
      {t("course.semesterPerspective")}
      <SelectField
        value={selectedId ?? ""}
        onChange={(next) => onChange(next || null)}
        label={t("course.semesterPerspective")}
        options={[
          { value: "", label: t("course.current") },
          ...semesters.map((semester) => ({
            value: semester.id,
            label: semester.name,
          })),
        ]}
      />
    </label>
  );
}
