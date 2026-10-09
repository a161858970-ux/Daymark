/**
 * Deterministic natural-language time parsing.
 * Pure functions; fixed capture clock/timezone injected by callers.
 * Never invents values it cannot prove. See 22_NATURAL_LANGUAGE_TIME_SPEC.md.
 */

export type TimePrecision = "DATE" | "DATETIME";
export type TimeSemantic = "start" | "occurrence" | "due";

export interface SourceSpan {
  start: number;
  end: number;
}

export interface ParsedTimeValue {
  semantic: TimeSemantic;
  precision: TimePrecision;
  /** YYYY-MM-DD when precision is DATE */
  date: string | null;
  /** UTC ISO instant when precision is DATETIME */
  instant: string | null;
  /** Phrase as written in the source text */
  rawPhrase: string;
  span: SourceSpan;
  /** IANA zone used for interpretation */
  timeZone: string | null;
  evidence: string;
  /** Strict "before target day" → deadline is previous local day end */
  beforeTarget: boolean;
}

export interface UnresolvedTimePhrase {
  rawPhrase: string;
  span: SourceSpan;
  reason: string;
}

export interface TimeParseResult {
  resolved: ParsedTimeValue[];
  unresolved: UnresolvedTimePhrase[];
}

export interface ParseTimeInput {
  text: string;
  /** Capture instant (ISO). Local calendar day is derived from this + timeZone. */
  capturedAt: string;
  /**
   * IANA timezone at capture. Required for relative days/weekdays and
   * year-less date completion without semester context. Historical captures
   * without `captured_tz` pass null — relative phrases stay unresolved
   * (ADR-010). Absolute dates with an explicit year still parse.
   */
  timeZone: string | null;
  /** Optional semester week ranges for 第 N 周 */
  semesterWeeks?: readonly {
    week_number: number;
    start_date: string;
    end_date: string;
  }[];
  /** Optional semester date range for year-less completion */
  semester?: { start_date: string; end_date: string } | null;
  /** Preferred year when semester context applies */
  semesterYear?: number | null;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Local calendar date of an instant in an IANA zone (DST-safe). */
export function localDateOfInstant(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const field = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

/** Build a UTC instant for a local wall-clock time in an IANA zone. */
export function instantFromLocal(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  // Iterate to resolve DST offsets correctly.
  const guess = new Date(`${date}T00:00:00Z`).getTime();
  const offset = zoneOffsetMs(guess, timeZone);
  let instant = guess + hour * 3600_000 + minute * 60_000 - offset;
  const offset2 = zoneOffsetMs(instant, timeZone);
  if (offset2 !== offset) {
    instant = guess + hour * 3600_000 + minute * 60_000 - offset2;
  }
  return new Date(instant).toISOString();
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const map: Record<string, string> = {};
  for (const part of parts)
    if (part.type !== "literal") map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instantMs;
}

/** Exclusive boundary: next local midnight after the given local date (end-of-day semantics). */
export function endOfLocalDayInstant(date: string, timeZone: string): string {
  return instantFromLocal(addDays(date, 1), 0, 0, timeZone);
}

export function startOfLocalDayInstant(date: string, timeZone: string): string {
  return instantFromLocal(date, 0, 0, timeZone);
}

export function localDay0900Instant(date: string, timeZone: string): string {
  return instantFromLocal(date, 9, 0, timeZone);
}

/** Monday=1 … Sunday=7 */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfNaturalWeek(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

function chineseDigit(n: string): number | null {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
    末: 6,
  };
  if (/^\d+$/.test(n)) return Number(n);
  return map[n] ?? null;
}

function chineseNumeral(n: string): number | null {
  if (/^\d+$/.test(n)) return Number(n);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (n.length === 1) return digits[n] ?? null;
  if (n === "十") return 10;
  if (n.startsWith("十")) {
    const rest = digits[n.slice(1)];
    return rest == null ? null : 10 + rest;
  }
  if (n.includes("十")) {
    const [a = "", b = ""] = n.split("十");
    const tens = a ? (digits[a] ?? null) : 1;
    const ones = b ? (digits[b] ?? null) : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateOnly(year: number, month: number, day: number): string | null {
  const value = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateOnly(value) ? value : null;
}

/**
 * Year-less MM-DD completion per approved priority:
 * 1) semester year if expression fits the semester window (or its year)
 * 2) nearest not-yet-past local date from capture day (same day ok)
 */
export function completeYearlessMonthDay(
  month: number,
  day: number,
  input: ParseTimeInput,
  captureLocalDate: string | null,
): { date: string; evidence: string } | null {
  const candidates: { year: number; evidence: string }[] = [];
  const semesterYear = input.semesterYear ?? null;
  if (semesterYear != null) {
    candidates.push({ year: semesterYear, evidence: "semester-year" });
  }
  // Historical missing tz and no semester year → do not guess a year.
  if (!captureLocalDate && semesterYear == null) return null;
  if (captureLocalDate) {
    const captureYear = Number(captureLocalDate.slice(0, 4));
    candidates.push(
      { year: captureYear, evidence: "capture-year" },
      { year: captureYear + 1, evidence: "next-year" },
      { year: captureYear - 1, evidence: "prev-year" },
    );
  }
  const seen = new Set<number>();
  const evaluated: { date: string; evidence: string; rank: number }[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.year)) continue;
    seen.add(candidate.year);
    const value = dateOnly(candidate.year, month, day);
    if (!value) continue;
    let rank: number;
    if (candidate.evidence === "semester-year") rank = 0;
    else if (
      input.semester &&
      value >= input.semester.start_date &&
      value <= input.semester.end_date
    )
      rank = 0;
    else if (captureLocalDate && value >= captureLocalDate) rank = 1;
    else if (!captureLocalDate) rank = 0;
    else rank = 3;
    evaluated.push({ date: value, evidence: candidate.evidence, rank });
  }
  evaluated.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.date.localeCompare(b.date) ||
      a.evidence.localeCompare(b.evidence),
  );
  const preferred = evaluated.find((entry) => entry.rank === 0);
  const future = captureLocalDate
    ? evaluated
        .filter((entry) => entry.date >= captureLocalDate)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
    : preferred;
  const chosen = preferred ?? future;
  if (!chosen) return null;
  // Two substantively different high-rank readings → refuse.
  if (
    preferred &&
    future &&
    preferred.date !== future.date &&
    preferred.rank === 0
  ) {
    // Semester wins by approved priority 1; not ambiguous.
    return { date: preferred.date, evidence: "semester-or-context" };
  }
  return { date: chosen.date, evidence: chosen.evidence };
}

interface DateAnchor {
  date: string;
  rawPhrase: string;
  span: SourceSpan;
  evidence: string;
  hasClock: boolean;
  hour?: number | undefined;
  minute?: number | undefined;
  clockPhrase?: string | undefined;
}

function parseClock(
  text: string,
  index: number,
): {
  hour: number;
  minute: number;
  length: number;
  phrase: string;
  reliable: boolean;
} | null {
  const slice = text.slice(index);
  const leadingSpace = /^\s*/.exec(slice)![0].length;
  const body = slice.slice(leadingSpace);
  // 15:00 / 15：00
  const colon = /^(\d{1,2})[:：](\d{2})/.exec(body);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour <= 23 && minute <= 59) {
      return {
        hour,
        minute,
        length: leadingSpace + colon[0].length,
        phrase: colon[0],
        reliable: true,
      };
    }
  }
  // 下午3点 / 上午9点半 / 晚上8点 / 中午12点
  const period =
    /^(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?(\d{1,2})[:：]?(\d{2}|半)?\s*点\s*(\d{1,2}分)?/.exec(
      body,
    );
  if (
    period &&
    (period[1] || index === 0 || /[\s，,：:的]/.test(text[index - 1] ?? " "))
  ) {
    const periodWord = period[1] ?? "";
    let hour = Number(period[2]);
    let minute = 0;
    if (period[3] === "半") minute = 30;
    else if (period[3]) minute = Number(period[3]);
    if (period[4]) minute = Number(period[4].replace("分", ""));
    if (hour > 24) return null;
    if (!periodWord) {
      // Bare "8点" without AM/PM → not reliable (spec §2.4).
      return {
        hour,
        minute,
        length: leadingSpace + period[0].length,
        phrase: period[0],
        reliable: false,
      };
    }
    if (
      periodWord === "下午" ||
      periodWord === "傍晚" ||
      periodWord === "晚上" ||
      periodWord === "夜里"
    ) {
      if (hour < 12) hour += 12;
    } else if (periodWord === "中午") {
      if (hour < 11) hour += 12;
    } else if (periodWord === "凌晨") {
      if (hour === 12) hour = 0;
    }
    if (hour === 24) hour = 0;
    return {
      hour,
      minute,
      length: leadingSpace + period[0].length,
      phrase: period[0],
      reliable: true,
    };
  }
  return null;
}

function findDateAnchors(
  text: string,
  input: ParseTimeInput,
  captureLocalDate: string | null,
): DateAnchor[] {
  const anchors: DateAnchor[] = [];
  const patterns: {
    re: RegExp;
    handler: (m: RegExpExecArray) => {
      month: number;
      day: number;
      year?: number;
      phrase: string;
      index: number;
    } | null;
  }[] = [
    {
      re: /(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})\s*日?/g,
      handler: (m) => ({
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        phrase: m[0],
        index: m.index,
      }),
    },
    {
      re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g,
      handler: (m) => ({
        month: Number(m[1]),
        day: Number(m[2]),
        phrase: m[0],
        index: m.index,
      }),
    },
    {
      re: /(\d{1,2})[./](\d{1,2})(?!\d)/g,
      handler: (m) => ({
        month: Number(m[1]),
        day: Number(m[2]),
        phrase: m[0],
        index: m.index,
      }),
    },
  ];
  for (const { re, handler } of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const parsed = handler(match);
      if (!parsed) continue;
      if (
        parsed.month < 1 ||
        parsed.month > 12 ||
        parsed.day < 1 ||
        parsed.day > 31
      )
        continue;
      let date: string | null;
      let evidence: string;
      if (parsed.year != null) {
        date = dateOnly(parsed.year, parsed.month, parsed.day);
        evidence = "absolute-with-year";
      } else {
        const completed = completeYearlessMonthDay(
          parsed.month,
          parsed.day,
          input,
          captureLocalDate,
        );
        if (!completed) continue;
        date = completed.date;
        evidence = completed.evidence;
      }
      if (!date) continue;
      // Optional clock after the date phrase
      const after = parseClock(text, parsed.index + parsed.phrase.length);
      const spanEnd =
        parsed.index +
        parsed.phrase.length +
        (after && after.reliable ? after.length : 0);
      anchors.push({
        date,
        rawPhrase: text.slice(parsed.index, spanEnd),
        span: { start: parsed.index, end: spanEnd },
        evidence,
        hasClock: Boolean(after?.reliable),
        hour: after?.reliable ? after.hour : undefined,
        minute: after?.reliable ? after.minute : undefined,
        clockPhrase: after?.reliable ? after.phrase : undefined,
      });
    }
  }
  return anchors;
}

function findRelativeAnchors(
  text: string,
  input: ParseTimeInput,
  captureLocalDate: string | null,
): DateAnchor[] {
  // Relative days/weekdays require a known capture local date (captured_tz).
  if (!captureLocalDate) return [];
  const anchors: DateAnchor[] = [];
  const relatives: { re: RegExp; offsetDays: number; label: string }[] = [
    { re: /大后天/g, offsetDays: 3, label: "relative-day" },
    { re: /后天/g, offsetDays: 2, label: "relative-day" },
    { re: /明天|明日/g, offsetDays: 1, label: "relative-day" },
    { re: /今天|今日|当晚/g, offsetDays: 0, label: "relative-day" },
    { re: /昨天|昨日/g, offsetDays: -1, label: "relative-day" },
  ];
  for (const { re, offsetDays, label } of relatives) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const date = addDays(captureLocalDate, offsetDays);
      const after = parseClock(text, match.index + match[0].length);
      const spanEnd =
        match.index + match[0].length + (after?.reliable ? after.length : 0);
      anchors.push({
        date,
        rawPhrase: text.slice(match.index, spanEnd),
        span: { start: match.index, end: spanEnd },
        evidence: label,
        hasClock: Boolean(after?.reliable),
        hour: after?.reliable ? after.hour : undefined,
        minute: after?.reliable ? after.minute : undefined,
        clockPhrase: after?.reliable ? after.phrase : undefined,
      });
    }
  }

  // Weekday: (下下|下|本|这)?周X / 星期X — longer prefixes first.
  const weekRe = /(下下|下|本|这)?\s*(?:周|星期)([一二三四五六日天])/g;
  let weekMatch: RegExpExecArray | null;
  while ((weekMatch = weekRe.exec(text))) {
    const prefix = weekMatch[1] ?? "";
    const weekday = chineseDigit(weekMatch[2]!);
    if (weekday == null) continue;
    const target = weekday === 7 ? 7 : weekday;
    let date: string;
    if (prefix === "下") {
      date = addDays(startOfNaturalWeek(captureLocalDate), 7 + (target - 1));
    } else if (prefix === "下下") {
      date = addDays(startOfNaturalWeek(captureLocalDate), 14 + (target - 1));
    } else if (prefix === "本" || prefix === "这") {
      date = addDays(startOfNaturalWeek(captureLocalDate), target - 1);
    } else {
      // Bare weekday: nearest future candidate; same day allowed.
      const thisWeek = addDays(
        startOfNaturalWeek(captureLocalDate),
        target - 1,
      );
      date =
        thisWeek < captureLocalDate
          ? addDays(startOfNaturalWeek(captureLocalDate), 7 + (target - 1))
          : thisWeek;
    }
    const after = parseClock(text, weekMatch.index + weekMatch[0].length);
    const spanEnd =
      weekMatch.index +
      weekMatch[0].length +
      (after?.reliable ? after.length : 0);
    anchors.push({
      date,
      rawPhrase: text.slice(weekMatch.index, spanEnd),
      span: { start: weekMatch.index, end: spanEnd },
      evidence: prefix || "bare-weekday",
      hasClock: Boolean(after?.reliable),
      hour: after?.reliable ? after.hour : undefined,
      minute: after?.reliable ? after.minute : undefined,
      clockPhrase: after?.reliable ? after.phrase : undefined,
    });
  }
  return anchors;
}

function findSemesterWeekAnchors(
  text: string,
  input: ParseTimeInput,
): {
  weekAnchors: {
    weekNumber: number;
    rawPhrase: string;
    span: SourceSpan;
    mode: "before" | "in" | "end" | "bare";
    startDate: string | null;
    endDate: string | null;
  }[];
  unresolved: UnresolvedTimePhrase[];
} {
  const weekAnchors: {
    weekNumber: number;
    rawPhrase: string;
    span: SourceSpan;
    mode: "before" | "in" | "end" | "bare";
    startDate: string | null;
    endDate: string | null;
  }[] = [];
  const unresolved: UnresolvedTimePhrase[] = [];
  const re = /第\s*([一二三四五六七八九十\d]+)\s*周/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const weekNumber = chineseNumeral(match[1]!);
    if (weekNumber == null || weekNumber < 1) continue;
    const rest = text.slice(
      match.index + match[0].length,
      match.index + match[0].length + 6,
    );
    let mode: "before" | "in" | "end" | "bare" = "bare";
    let phrase = match[0];
    if (/^(结束前|内|之内|中间)/.test(rest)) {
      mode = "end";
      phrase = match[0] + rest.slice(0, 2);
    } else if (/^前/.test(rest)) {
      mode = "before";
      phrase = match[0] + "前";
    }
    const mapped = input.semesterWeeks?.find(
      (w) => w.week_number === weekNumber,
    );
    weekAnchors.push({
      weekNumber,
      rawPhrase: phrase,
      span: { start: match.index, end: match.index + phrase.length },
      mode,
      startDate: mapped?.start_date ?? null,
      endDate: mapped?.end_date ?? null,
    });
  }
  return { weekAnchors, unresolved };
}

function detectSemantic(
  text: string,
  span: SourceSpan,
): { semantic: TimeSemantic; beforeTarget: boolean } {
  const before = text.slice(Math.max(0, span.start - 2), span.start);
  const after = text.slice(span.end, span.end + 6);
  const rawBefore = text.slice(Math.max(0, span.start - 3), span.start);
  if (
    /前$/.test(rawBefore) ||
    after.startsWith("前") ||
    /前(?:提交|交|完成)?/.test(after.slice(0, 4))
  ) {
    // "X前" may itself be part of the phrase; handled at call site too.
    if (
      after.startsWith("前") ||
      /前/.test(text.slice(span.end, span.end + 1))
    ) {
      return { semantic: "due", beforeTarget: true };
    }
    if (/前$/.test(before)) return { semantic: "due", beforeTarget: true };
  }
  if (
    /截止|之前|之前交|deadline|due/i.test(after) ||
    /截止/.test(text.slice(span.end, span.end + 4))
  ) {
    return { semantic: "due", beforeTarget: false };
  }
  if (
    /截止|交$|交作业|交报告|提交|之前/.test(after) ||
    /截止/.test(text.slice(span.end, span.end + 2))
  ) {
    return { semantic: "due", beforeTarget: false };
  }
  if (
    /展示|报告会|活动|发生|举行|开始上课|开学|考试|答辩|面试|开会|聚会|旅行|出发/.test(
      after,
    )
  ) {
    return { semantic: "occurrence", beforeTarget: false };
  }
  // Default: if phrase is followed by action-object completion words, due;
  // otherwise occurrence for events, due for task-like endings.
  if (
    /作业|报告|论文|材料|报名|缴费|申请|作品|提交|交$/.test(
      after + text.slice(span.end, span.end + 8),
    )
  ) {
    return { semantic: "due", beforeTarget: false };
  }
  return { semantic: "occurrence", beforeTarget: false };
}

/**
 * Expand a resolved time span to absorb trailing deadline markers that are
 * part of the temporal expression (`10.12截止`, `…15:00截止`, `…之前`).
 * Action verbs with objects (`交报告`, `提交作业`) are NOT absorbed.
 */
function expandDeadlineMarker(
  text: string,
  span: SourceSpan,
  semantic: TimeSemantic,
): SourceSpan {
  if (semantic !== "due") return span;
  let end = span.end;
  // Optional single space before the marker.
  const rest = text.slice(end);
  const spaced = /^\s*(截止|之前)/.exec(rest);
  if (spaced) {
    end += spaced[0].length;
    return { start: span.start, end };
  }
  // Bare trailing 交/截止 at end of input (`10.12交`) is a deadline marker.
  const bare = /^\s*(交|截止)$/.exec(rest);
  if (bare) {
    end += bare[0].length;
    return { start: span.start, end };
  }
  return span;
}

function refineSemanticFromContext(
  text: string,
  span: SourceSpan,
  fallback: { semantic: TimeSemantic; beforeTarget: boolean },
): { semantic: TimeSemantic; beforeTarget: boolean } {
  const window = text.slice(
    Math.max(0, span.start - 8),
    Math.min(text.length, span.end + 10),
  );
  const after = text.slice(span.end);
  if (/(截止|之前|前交|日前|周前)/.test(window) || after.startsWith("前")) {
    return {
      semantic: "due",
      beforeTarget:
        /前/.test(window.slice(0, window.length)) &&
        !/截止/.test(after.slice(0, 4)),
    };
  }
  if (/截止/.test(after.slice(0, 6)) || /截止/.test(window)) {
    return { semantic: "due", beforeTarget: false };
  }
  if (
    /(作业|报告|论文|作品|材料|报名|费用|房租|缴费)/.test(window) &&
    /(交|截止|提交|准备)/.test(window)
  ) {
    return { semantic: "due", beforeTarget: false };
  }
  if (/(展示|活动|会议|考试|答辩|面试|聚会|讲座|开幕|举行|开始)/.test(window)) {
    return { semantic: "occurrence", beforeTarget: false };
  }
  return fallback;
}

/**
 * Main entry: extract structured times without inventing unproven values.
 * Classification / title purification live in captureParsing.ts.
 */
export function parseTimes(input: ParseTimeInput): TimeParseResult {
  const text = input.text;
  const resolved: ParsedTimeValue[] = [];
  const unresolved: UnresolvedTimePhrase[] = [];
  const tz = input.timeZone;
  const captureLocalDate = tz ? localDateOfInstant(input.capturedAt, tz) : null;

  const dateAnchors = findDateAnchors(text, input, captureLocalDate);
  const relativeAnchors = findRelativeAnchors(text, input, captureLocalDate);
  const anchors = [...dateAnchors, ...relativeAnchors].sort(
    (a, b) => a.span.start - b.span.start,
  );

  // Historical captures without captured_tz: leave relative phrases in text.
  if (!captureLocalDate) {
    const relativeHint =
      /(今天|今日|明天|明日|后天|大后天|昨天|昨日|下周|本周|这周|星期[一二三四五六日天]|周[一二三四五六日天])/;
    if (relativeHint.test(text)) {
      const match = relativeHint.exec(text);
      if (match) {
        unresolved.push({
          rawPhrase: match[0],
          span: { start: match.index, end: match.index + match[0].length },
          reason: "历史记录缺少捕获时区，相对日期不自动补全",
        });
      }
    }
  }

  const { weekAnchors } = findSemesterWeekAnchors(text, input);

  const used = new Set<number>();

  for (const anchor of anchors) {
    if (used.has(anchor.span.start)) continue;
    used.add(anchor.span.start);
    let semanticInfo = detectSemantic(text, anchor.span);
    semanticInfo = refineSemanticFromContext(text, anchor.span, semanticInfo);

    // Expand phrase for "X前" and trailing deadline markers (截止/之前).
    let span = anchor.span;
    let beforeTarget = semanticInfo.beforeTarget;
    if (text.slice(span.end, span.end + 1) === "前") {
      span = { start: span.start, end: span.end + 1 };
      beforeTarget = true;
      semanticInfo = { semantic: "due", beforeTarget: true };
    }
    span = expandDeadlineMarker(text, span, semanticInfo.semantic);
    const rawPhrase = text.slice(span.start, span.end);

    // DATETIME (clock) requires a known capture timezone to build an instant.
    if (anchor.hasClock && anchor.hour != null && tz) {
      const instant = beforeTarget
        ? endOfLocalDayInstant(anchor.date, tz)
        : instantFromLocal(anchor.date, anchor.hour, anchor.minute ?? 0, tz);
      // For "X 15:00前" treat as DATETIME deadline at that clock, not day-end.
      const finalInstant =
        beforeTarget && anchor.hasClock
          ? instantFromLocal(anchor.date, anchor.hour, anchor.minute ?? 0, tz)
          : instant;
      resolved.push({
        semantic: semanticInfo.semantic,
        precision: "DATETIME",
        date: null,
        instant: finalInstant,
        rawPhrase,
        span,
        timeZone: tz,
        evidence: `${anchor.evidence}+clock`,
        beforeTarget,
      });
      continue;
    }

    // DATE precision (clock without tz stays in the title, date only if proven).
    let dateValue = anchor.date;
    if (beforeTarget) {
      dateValue = addDays(anchor.date, -1);
    }
    resolved.push({
      semantic: semanticInfo.semantic,
      precision: "DATE",
      date: dateValue,
      instant: null,
      rawPhrase,
      span,
      timeZone: tz ?? "",
      evidence: anchor.evidence,
      beforeTarget,
    });
  }

  for (const week of weekAnchors) {
    if (!week.startDate) {
      unresolved.push({
        rawPhrase: week.rawPhrase,
        span: week.span,
        reason: "缺少可靠的学期周次映射",
      });
      continue;
    }
    if (week.mode === "bare") {
      unresolved.push({
        rawPhrase: week.rawPhrase,
        span: week.span,
        reason: "仅有周次、未指明具体日期，不自动伪造日期",
      });
      continue;
    }
    if (week.mode === "before") {
      // Due = previous local day end of week start → DATE of previous day
      const dueDate = addDays(week.startDate, -1);
      resolved.push({
        semantic: "due",
        precision: "DATE",
        date: dueDate,
        instant: null,
        rawPhrase: week.rawPhrase,
        span: week.span,
        timeZone: tz,
        evidence: "semester-week-before",
        beforeTarget: true,
      });
      continue;
    }
    // in / end → due at last day of week
    if (!week.endDate) continue;
    resolved.push({
      semantic: "due",
      precision: "DATE",
      date: week.endDate,
      instant: null,
      rawPhrase: week.rawPhrase,
      span: week.span,
      timeZone: input.timeZone,
      evidence: "semester-week-end",
      beforeTarget: false,
    });
  }

  // Unreliable bare clocks that were not absorbed
  const bareClock = /(?:^|[\s，,])(\d{1,2})\s*点(?!\s*半|\s*\d)/g;
  let bare: RegExpExecArray | null;
  while ((bare = bareClock.exec(text))) {
    const start = bare.index + (bare[0].length - bare[0].trimStart().length);
    const already = resolved.some(
      (r) => r.span.start <= start && start < r.span.end,
    );
    if (already) continue;
    unresolved.push({
      rawPhrase: bare[0].trim(),
      span: { start, end: start + bare[0].trim().length },
      reason: "缺少上午/下午等可靠时段信息",
    });
  }

  return { resolved, unresolved };
}

/** Convert resolved DATE/DATETIME into Item field payloads. */
export function timesToItemFields(times: ParsedTimeValue[]): {
  start_at: string | null;
  start_date: string | null;
  occurrence_start_at: string | null;
  occurrence_start_date: string | null;
  occurrence_end_at: string | null;
  occurrence_end_date: string | null;
  due_at: string | null;
  due_date: string | null;
} {
  const fields = {
    start_at: null as string | null,
    start_date: null as string | null,
    occurrence_start_at: null as string | null,
    occurrence_start_date: null as string | null,
    occurrence_end_at: null as string | null,
    occurrence_end_date: null as string | null,
    due_at: null as string | null,
    due_date: null as string | null,
  };
  for (const time of times) {
    if (time.semantic === "due") {
      if (time.precision === "DATE") fields.due_date = time.date;
      else fields.due_at = time.instant;
    } else if (time.semantic === "start") {
      if (time.precision === "DATE") fields.start_date = time.date;
      else fields.start_at = time.instant;
    } else {
      // occurrence — first sets start; second sets end if different
      const isDate = time.precision === "DATE";
      const startKey = isDate ? "occurrence_start_date" : "occurrence_start_at";
      const endKey = isDate ? "occurrence_end_date" : "occurrence_end_at";
      const value = isDate ? time.date : time.instant;
      if (!fields[startKey]) {
        fields[startKey] = value;
      } else if (fields[startKey] !== value && !fields[endKey]) {
        // Only auto-fill end when later than start
        const cmp = String(value).localeCompare(String(fields[startKey]));
        if (cmp > 0) fields[endKey] = value;
        else {
          fields[endKey] = fields[startKey];
          fields[startKey] = value;
        }
      }
    }
  }
  return fields;
}
