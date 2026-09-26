import { preprocessCapture } from "@course-manager/application";
import {
  interpretationSchema,
  type CaptureInterpretation,
  type InterpretationRequest,
} from "@course-manager/contracts";
import type { Course, RawCapture } from "@course-manager/domain";
import { CloudCourseManager, CloudError } from "../db/cloud.js";
import { CloudAcademicManager } from "../db/academic.js";
import type { RateLimiter } from "../rateLimit.js";

export interface InterpretationProvider {
  interpret(input: {
    rawText: string;
    source: RawCapture["source"];
    currentCourseName: string | null;
    candidateCourseNames: string[];
    semesterDates: { start: string; end: string } | null;
    currentDate: string;
  }): Promise<unknown>;
}

export class CaptureInterpretationService {
  constructor(
    private readonly cloud: CloudCourseManager,
    private readonly academic: CloudAcademicManager | null,
    private readonly provider: InterpretationProvider | null,
    /** AI quota is charged only when the provider is actually invoked. */
    private readonly limiter: RateLimiter | null = null,
  ) {}

  private gateAi(ownerId: string): void {
    if (!this.limiter) return;
    const result = this.limiter.check(`owner:${ownerId}`);
    if (result.allowed) return;
    throw new CloudError("RATE_LIMITED", 429, "请求过于频繁，请稍后再试。", {
      retry_after_seconds: result.retryAfterSeconds,
    });
  }

  async interpret(ownerId: string, request: InterpretationRequest) {
    const capture = await this.cloud.getRawCapture(
      ownerId,
      request.raw_capture_id,
    );
    if (!capture || capture.processing_status === "DELETED")
      throw new CloudError("NOT_FOUND", 404, "Raw capture not found");
    if (capture.processing_status === "RESOLVED")
      throw new CloudError(
        "VALIDATION_ERROR",
        409,
        "Raw capture is already resolved",
      );

    const context = request.context;
    const ids = [
      ...new Set([
        ...context.candidate_course_ids,
        ...(context.current_course_id ? [context.current_course_id] : []),
      ]),
    ];
    const courses = await Promise.all(
      ids.map((id) => this.cloud.getCourse(ownerId, id)),
    );
    if (courses.some((course) => !course))
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Course context is unavailable",
      );
    const knownCourses = courses as Course[];
    const currentCourse =
      knownCourses.find((course) => course.id === context.current_course_id) ??
      null;
    const semester =
      context.current_semester_id && this.academic
        ? await this.academic.semester(ownerId, context.current_semester_id)
        : null;
    if (context.current_semester_id && !semester)
      throw new CloudError(
        "VALIDATION_ERROR",
        400,
        "Semester context is unavailable",
      );
    const parsed = preprocessCapture({
      rawText: capture.raw_text,
      source: capture.source,
      contextCourseId: currentCourse?.id ?? null,
      courses: knownCourses,
    });
    const empty = {
      title: null,
      detail: null,
      course_candidate: currentCourse?.name ?? null,
      start_at: null,
      occurrence_start_at: null,
      occurrence_end_at: null,
      due_at: null,
      course_information: null,
      split_candidates: [] as string[],
      confidence: 1,
      uncertainty: null,
    };
    if (parsed.classification === "ITEM")
      return {
        source: "DETERMINISTIC" as const,
        requires_confirmation: false,
        interpretation: interpretationSchema.parse({
          ...empty,
          classification: "ITEM",
          title: parsed.title,
          course_candidate:
            currentCourse?.name ?? parsed.courseMatches[0]?.name ?? null,
        }),
      };
    if (parsed.classification === "COURSE_INFORMATION")
      return {
        source: "DETERMINISTIC" as const,
        requires_confirmation: false,
        interpretation: interpretationSchema.parse({
          ...empty,
          classification: "COURSE_INFORMATION",
          course_information: parsed.title,
          course_candidate:
            currentCourse?.name ?? parsed.courseMatches[0]?.name ?? null,
        }),
      };
    if (parsed.splitCandidates.length > 1)
      return {
        source: "DETERMINISTIC" as const,
        requires_confirmation: true,
        interpretation: interpretationSchema.parse({
          ...empty,
          classification: "MULTI_ITEM_CANDIDATE",
          title: parsed.title,
          split_candidates: parsed.splitCandidates,
        }),
      };

    if (!this.provider)
      throw new CloudError(
        "AI_UNAVAILABLE",
        503,
        "Interpretation provider is unavailable",
      );
    let value: unknown;
    this.gateAi(ownerId);
    try {
      value = await this.provider.interpret({
        rawText: capture.raw_text,
        source: capture.source,
        currentCourseName: currentCourse?.name ?? null,
        candidateCourseNames: knownCourses.map((course) => course.name),
        semesterDates: semester
          ? { start: semester.start_date, end: semester.end_date }
          : null,
        currentDate: new Date().toISOString().slice(0, 10),
      });
    } catch {
      throw new CloudError(
        "AI_UNAVAILABLE",
        503,
        "Interpretation provider is unavailable",
      );
    }
    const result = interpretationSchema.safeParse(value);
    if (
      !result.success ||
      !this.supportedBySource(
        capture.raw_text,
        knownCourses,
        currentCourse,
        result.data,
      )
    )
      throw new CloudError(
        "AI_INVALID_OUTPUT",
        502,
        "Interpretation could not be validated",
      );
    return {
      source: "AI" as const,
      requires_confirmation: true,
      interpretation: result.data,
    };
  }

  private supportedBySource(
    rawText: string,
    courses: Course[],
    currentCourse: Course | null,
    value: CaptureInterpretation,
  ): boolean {
    const normalized = rawText.trim().replace(/\s+/g, " ");
    const sourceContains = (candidate: string | null) =>
      !candidate || normalized.includes(candidate.trim());
    if (
      ![
        value.title,
        value.detail,
        value.course_information,
        ...value.split_candidates,
      ].every(sourceContains)
    )
      return false;
    if (value.course_candidate) {
      const matches = courses.filter(
        (course) => course.name === value.course_candidate,
      );
      if (
        matches.length === 0 ||
        (!matches.some((course) => course.id === currentCourse?.id) &&
          !normalized.includes(value.course_candidate))
      )
        return false;
    }
    const hasTime =
      /\d{4}[-年/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|第[一二三四五六七八九十\d]+周|下周|明天|后天|周[一二三四五六日天]/u.test(
        normalized,
      );
    if (
      !hasTime &&
      [
        value.start_at,
        value.occurrence_start_at,
        value.occurrence_end_at,
        value.due_at,
      ].some(Boolean)
    )
      return false;
    if (
      value.classification === "MULTI_ITEM_CANDIDATE" &&
      value.split_candidates.length < 2
    )
      return false;
    if (value.classification === "ITEM" && !value.title) return false;
    if (
      value.classification === "COURSE_INFORMATION" &&
      !value.course_information
    )
      return false;
    return true;
  }
}
