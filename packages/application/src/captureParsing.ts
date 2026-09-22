import type { Course, RawCaptureSource } from "@course-manager/domain";

export interface CapturePreprocessing {
  normalized: string;
  title: string;
  resolvedCourseId: string | null;
  courseMatches: Course[];
  classification: "ITEM" | "COURSE_INFORMATION" | "UNRESOLVED";
  unresolvedReason: string | null;
  splitCandidates: string[];
}

const actionStart =
  /^(找|交|提交|准备|完成|看|阅读|写|整理|联系|参加|复习|购买|制作|发送|确认|预约)/u;
const informationStart =
  /^(老师(说|提到|表示)|期末(考试)?会|考试会|教材是|参考书是)/u;
const timeExpression =
  /\d{4}[-年/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|第[一二三四五六七八九十\d]+周|下周|明天|后天|周[一二三四五六日天]/u;

/** Conservative hint only. A split always requires a user decision. */
export function detectSplitCandidates(text: string): string[] {
  const parts = text
    .split(/[，,；;。]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.every((part) => actionStart.test(part))
    ? parts
    : [];
}

/** Pure preprocessing. RawCapture.raw_text is never changed by this function. */
export function preprocessCapture(input: {
  rawText: string;
  source: RawCaptureSource;
  contextCourseId: string | null;
  courses: Course[];
}): CapturePreprocessing {
  const normalized = input.rawText.trim().replace(/\s+/g, " ");
  const courseMatches = input.contextCourseId
    ? []
    : input.courses.filter(
        (course) =>
          course.deleted_at === null && normalized.includes(course.name),
      );
  const resolvedCourseId =
    input.contextCourseId ??
    (courseMatches.length === 1 ? courseMatches[0]!.id : null);
  const title =
    courseMatches.length === 1 && normalized.startsWith(courseMatches[0]!.name)
      ? normalized
          .slice(courseMatches[0]!.name.length)
          .replace(/^[，,：:\s]+/u, "")
          .trim() || normalized
      : normalized;
  const clearAction = input.source === "COURSE_ITEM" || actionStart.test(title);
  const clearInformation =
    input.source === "COURSE_INFORMATION" ||
    (input.source !== "COURSE_ITEM" && informationStart.test(title));
  const containsDate = timeExpression.test(normalized);
  const splitCandidates = detectSplitCandidates(title);

  if (clearInformation && resolvedCourseId && courseMatches.length <= 1) {
    return {
      normalized,
      title,
      resolvedCourseId,
      courseMatches,
      classification: "COURSE_INFORMATION",
      unresolvedReason: null,
      splitCandidates: [],
    };
  }
  if (
    clearAction &&
    !containsDate &&
    courseMatches.length <= 1 &&
    splitCandidates.length === 0
  ) {
    return {
      normalized,
      title,
      resolvedCourseId,
      courseMatches,
      classification: "ITEM",
      unresolvedReason: null,
      splitCandidates: [],
    };
  }
  const unresolvedReason =
    courseMatches.length > 1 || (clearInformation && !resolvedCourseId)
      ? "需要确认所属课程"
      : splitCandidates.length > 1
        ? "可能包含多个事项"
        : containsDate
          ? "需要确认时间语义"
          : "需要确认记录类型";
  return {
    normalized,
    title,
    resolvedCourseId,
    courseMatches,
    classification: "UNRESOLVED",
    unresolvedReason,
    splitCandidates,
  };
}
