import type { Course, RawCaptureSource } from "@daymark/domain";
import {
  parseTimes,
  timesToItemFields,
  type ParsedTimeValue,
  type UnresolvedTimePhrase,
  type ParseTimeInput,
} from "./timeParsing.js";

export type CaptureClassification =
  "ITEM" | "COURSE_INFORMATION" | "UNRESOLVED";

export interface CapturePreprocessing {
  normalized: string;
  title: string;
  content: string | null;
  resolvedCourseId: string | null;
  courseMatches: Course[];
  classification: CaptureClassification;
  unresolvedReason: string | null;
  splitCandidates: string[];
  /** Structured times absorbed into formal fields */
  times: ParsedTimeValue[];
  /** Temporal phrases that stay in the text */
  unresolvedTimes: UnresolvedTimePhrase[];
  /** Item field payload from parsed times (DATE/DATETIME pairs) */
  timeFields: ReturnType<typeof timesToItemFields>;
  /** True when a time phrase was safely removed from the title */
  titlePurified: boolean;
}

export interface PreprocessInput {
  rawText: string;
  source: RawCaptureSource;
  contextCourseId: string | null;
  courses: Course[];
  /** Parse-time context for deterministic time resolution */
  capturedAt: string;
  /** IANA zone at capture; null for historical rows without captured_tz. */
  timeZone: string | null;
  semesterWeeks?: ParseTimeInput["semesterWeeks"];
  semester?: ParseTimeInput["semester"];
  semesterYear?: number | null;
}

/** Action / task expressions (composable, not a single leading-verb list). */
const ACTION_PATTERNS = [
  /^(找|交|提交|准备|完成|看|阅读|写|整理|联系|参加|复习|购买|制作|发送|确认|预约|报名|缴费|打印|下载|上传|询问|打听|借|还|订|订|买|寄|填|改|补|审|签|领|搬|修|学|练|背|记|查|核对|通知|回复|跟进)/u,
  /(作业|报告|论文|材料|作品|报名|费用|房租|笔记|讲义|大纲|课件|试卷|题|清单|申请|证明|发票|合同)/u,
  /(截止|之前|前交|要交|得交|记得|别忘了|需要完成|待办)/u,
];

/** Course-fact / information expressions. */
const INFORMATION_PATTERNS = [
  /^(老师(说|提到|表示|讲|强调|要求)|期末(考试)?会|考试会|教材是|参考书是|课件|课件在|课件已|课件已上传)/u,
  /(会点名|会画重点|会考|不考|闭卷|开卷|开卷考试|随堂考|期中|期末|考勤|点名|占分|占\s*\d+\s*%|学分|学时)/u,
  /(教材|参考书|书目|阅读材料|ppt|PPT|课件|大纲|教学进度|答疑|office\s*hour)/u,
  /(老师说|老师提到|老师要求|老师讲|老师强调)/u,
];

const AMBIGUOUS_TEACHER = /(老师让我们|老师让咱们|老师叫我们|老师吩咐)/u;

function countActionHits(text: string): number {
  return ACTION_PATTERNS.filter((re) => re.test(text)).length;
}

function countInformationHits(text: string): number {
  return INFORMATION_PATTERNS.filter((re) => re.test(text)).length;
}

/** Conservative hint only. A split always requires a user decision. */
export function detectSplitCandidates(text: string): string[] {
  const parts = text
    .split(/[，,；;。]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  const everyAction = parts.every(
    (part) => countActionHits(part) >= 1 && !AMBIGUOUS_TEACHER.test(part),
  );
  const multiMarkers = parts.filter(
    (part) => countActionHits(part) >= 1 && part.length >= 2,
  );
  return everyAction || multiMarkers.length >= 2 ? parts : [];
}

/**
 * Grammar-safe removal of a span from text.
 * Returns null when the remainder would be ungrammatical / empty / broken.
 */
export function removeSpanSafely(
  text: string,
  start: number,
  end: number,
): string | null {
  if (start < 0 || end > text.length || start >= end) return null;
  let before = text.slice(0, start);
  let after = text.slice(end);
  // Remove one adjacent punctuation if the span was a trailing clause.
  if (after && /^[，,：:；;、\s]/.test(after) && before) {
    after = after.replace(/^[，,：:；;、\s]+/u, "");
  } else if (before && /[，,：:；;、\s]$/.test(before) && after) {
    before = before.replace(/[，,：:；;、\s]+$/u, "");
  }
  const joined = `${before}${after}`.trim();
  if (!joined) return null;
  // Dangling connectors / incomplete fragments.
  if (
    /^[的了着过和与及或在从对给把被而且但是因此所以然后就都还也又再很太非常]$/.test(
      joined,
    )
  )
    return null;
  if (/^[，,：:；;、。．.！!？?…—\-–]+$/.test(joined)) return null;
  if (/^(的|了|着|过|和|与|及|或|在|从|对|给|把|被)$/.test(joined)) return null;
  // Leftover leading connector after removing a leading time phrase.
  if (/^(然后|接着|并且|而且|以及|还有|后来)/.test(joined) && joined.length < 6)
    return null;
  // Broken word groups: two orphan particles.
  if (/^[们个们了的得地着过]{2,}$/.test(joined)) return null;
  // Must still look like a sentence/phrase with some content character.
  if (!/[一-鿿A-Za-z0-9]/.test(joined)) return null;
  // Suspicious trailing particles that needed the removed span.
  if (/(的|了|着|过)$/.test(joined) && joined.length <= 2) return null;
  return joined;
}

/** Remove only time spans that were absorbed by formal fields. */
export function purifyTitle(
  title: string,
  absorbedSpans: { start: number; end: number }[],
): { title: string; purified: boolean } {
  if (!absorbedSpans.length) return { title, purified: false };
  // Remove from the end so earlier spans stay valid.
  const ordered = [...absorbedSpans].sort((a, b) => b.start - a.start);
  let current = title;
  let purified = false;
  for (const span of ordered) {
    // Spans are relative to rawText; re-map against current title if needed.
    const start = Math.min(span.start, current.length);
    const end = Math.min(span.end, current.length);
    if (start >= end) continue;
    const next = removeSpanSafely(current, start, end);
    if (next == null) continue;
    current = next;
    purified = true;
  }
  return { title: current.trim() || title, purified };
}

/** Remove a unique course-name prefix label from course-information content. */
export function purifyCourseInformationContent(
  text: string,
  courseName: string,
  courseUnique: boolean,
): string {
  if (!courseUnique || !courseName) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith(courseName)) return text;
  const rest = trimmed.slice(courseName.length);
  // Only a leading context label: separator then sentence, not mid-sentence name.
  const cleaned = rest.replace(/^[，,：:\s]+/u, "").trim();
  if (!cleaned) return text;
  const result = removeSpanSafely(
    trimmed,
    0,
    courseName.length + (trimmed.length - courseName.length - rest.length),
  );
  // Prefer direct remainder when grammar-safe.
  if (
    /^[一-鿿A-Za-z]/.test(cleaned) &&
    !/^[的了着过和与及或在从对给把被]/.test(cleaned)
  ) {
    return cleaned;
  }
  return result ?? text;
}

/**
 * Pure preprocessing. RawCapture.raw_text is never changed by this function.
 * Time extraction and classification collaborate; unparseable time alone
 * does not block a clear ITEM.
 */
export function preprocessCapture(
  input: PreprocessInput,
): CapturePreprocessing {
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

  // Course name as leading label is stripped before time purification so spans
  // match the working title (see below).
  const courseLabel =
    courseMatches.length === 1 && normalized.startsWith(courseMatches[0]!.name)
      ? courseMatches[0]!.name
      : null;

  let title = normalized;
  if (courseLabel && input.source !== "COURSE_INFORMATION") {
    // Course name as leading label on an item: strip only if remainder is a title.
    const remainder = normalized
      .slice(courseLabel.length)
      .replace(/^[，,：:\s]+/u, "")
      .trim();
    if (remainder) title = remainder;
  }

  // Re-parse times against the working title so spans match purification.
  const titleTimes = parseTimes({
    text: title,
    capturedAt: input.capturedAt,
    timeZone: input.timeZone,
    semesterWeeks: input.semesterWeeks ?? [],
    semester: input.semester ?? null,
    semesterYear: input.semesterYear ?? null,
  });
  const purified = purifyTitle(
    title,
    titleTimes.resolved
      .filter((t) => t.precision === "DATE" || t.precision === "DATETIME")
      .map((t) => t.span),
  );
  title = purified.title;

  const content =
    input.source === "COURSE_INFORMATION" ||
    (courseLabel &&
      countInformationHits(normalized) > countActionHits(normalized))
      ? purifyCourseInformationContent(
          courseLabel
            ? normalized
                .slice(courseLabel.length)
                .replace(/^[，,：:\s]+/u, "")
                .trim() || normalized
            : normalized,
          courseLabel ?? "",
          Boolean(courseLabel),
        )
      : null;

  const clearAction =
    input.source === "COURSE_ITEM" ||
    countActionHits(title) >= 1 ||
    countActionHits(normalized) >= 2;
  const clearInformation =
    input.source === "COURSE_INFORMATION" ||
    (input.source !== "COURSE_ITEM" &&
      (countInformationHits(title) >= 1 ||
        countInformationHits(normalized) >= 2) &&
      countActionHits(title) === 0);
  const ambiguousTeacher = AMBIGUOUS_TEACHER.test(normalized);
  const splitCandidates = detectSplitCandidates(title || normalized);
  const multiCourse = courseMatches.length > 1;

  // Unresolved times alone must not block a clear ITEM.
  const hasUnresolvedTime = titleTimes.unresolved.length > 0;

  if (ambiguousTeacher && input.source !== "COURSE_ITEM") {
    return {
      normalized,
      title,
      content: null,
      resolvedCourseId,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "需要确认记录类型",
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  if (multiCourse) {
    return {
      normalized,
      title,
      content: null,
      resolvedCourseId: null,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "需要确认所属课程",
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  if (splitCandidates.length > 1) {
    return {
      normalized,
      title,
      content: null,
      resolvedCourseId,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "可能包含多个事项",
      splitCandidates,
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  if (clearInformation && resolvedCourseId && courseMatches.length <= 1) {
    return {
      normalized,
      title,
      content: content ?? title,
      resolvedCourseId,
      courseMatches,
      classification: "COURSE_INFORMATION",
      unresolvedReason: null,
      splitCandidates: [],
      times: [],
      unresolvedTimes: [],
      timeFields: timesToItemFields([]),
      titlePurified: false,
    };
  }

  if (clearInformation && !resolvedCourseId) {
    return {
      normalized,
      title,
      content: content ?? title,
      resolvedCourseId,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "需要确认所属课程",
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  // Clear action → ITEM even when times are incomplete (spec §2.1).
  if (clearAction && courseMatches.length <= 1) {
    return {
      normalized,
      title: title || normalized,
      content: null,
      resolvedCourseId,
      courseMatches,
      classification: "ITEM",
      unresolvedReason: null,
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: [
        ...titleTimes.unresolved,
        ...(hasUnresolvedTime ? [] : []),
      ],
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  // Information-like without course and without clear action still needs course.
  if (countInformationHits(normalized) > 0 && !resolvedCourseId) {
    return {
      normalized,
      title,
      content: content ?? title,
      resolvedCourseId,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "需要确认所属课程",
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  // Time present but type unclear → type ambiguity (not "time semantics").
  if (titleTimes.resolved.length > 0 || hasUnresolvedTime) {
    return {
      normalized,
      title,
      content: null,
      resolvedCourseId,
      courseMatches,
      classification: "UNRESOLVED",
      unresolvedReason: "需要确认记录类型",
      splitCandidates: [],
      times: titleTimes.resolved,
      unresolvedTimes: titleTimes.unresolved,
      timeFields: timesToItemFields(titleTimes.resolved),
      titlePurified: purified.purified,
    };
  }

  return {
    normalized,
    title,
    content: null,
    resolvedCourseId,
    courseMatches,
    classification: "UNRESOLVED",
    unresolvedReason: "需要确认记录类型",
    splitCandidates: [],
    times: [],
    unresolvedTimes: [],
    timeFields: timesToItemFields([]),
    titlePurified: false,
  };
}

/**
 * R-01: an explicit "提醒我" request defaults the new Item to HIGH; everything
 * else keeps the ordinary default. The user can still change it afterwards.
 */
export function reminderLevelForCapture(rawText: string): "NORMAL" | "HIGH" {
  return /提醒我|提醒一下我|记得提醒/.test(rawText) ? "HIGH" : "NORMAL";
}
