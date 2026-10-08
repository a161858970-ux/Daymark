import {
  courseImportResolutionSchema,
  type CourseImportCommitResult,
  type CourseImportJob,
  type CourseImportResolution,
  type CourseImportSourceType,
} from "@daymark/contracts";
import { synchronizeAuthenticatedData } from "./authSync.js";
import { beginAiTask } from "./aiTaskStore.js";
import { beginCourseCommit, endCourseCommit } from "./courseCommitStore.js";
import { apiBase } from "./apiBase.js";

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || body.data === undefined)
    throw new Error(body.error?.message ?? "课程表导入暂时不可用。");
  return body.data;
}

async function call<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return responseData<T>(
    await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    }),
  );
}

function fileSourceType(file: File): CourseImportSourceType {
  if (file.type === "application/pdf") return "PDF";
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "IMAGE";
  throw new Error("请选择 PDF、PNG、JPEG 或 WebP 课程表文件。");
}

async function fileBase64(file: File): Promise<string> {
  // Distinguish the two failures: an empty read is a stale/unreadable file
  // (the file input was reset while the token fetch was still in flight),
  // not an oversized one — collapsing them made both say "15 MB".
  if (!file.size) throw new Error("无法读取该课程表文件，请重新选择一次。");
  if (file.size > 15 * 1024 * 1024) throw new Error("课程表文件需小于 15 MB。");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取课程表文件。"));
    reader.onload = () => {
      const value = String(reader.result);
      const separator = value.indexOf(",");
      if (separator < 0) reject(new Error("无法读取课程表文件。"));
      else resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function uploadSource(
  token: string,
  jobId: string,
  file: File,
): Promise<CourseImportJob> {
  // The server parses with the AI model while this request is open; the
  // widget must start when the upload leaves, not when the answer lands.
  const endAiTask = beginAiTask("course-import");
  try {
    const job = await call<CourseImportJob>(
      token,
      `/api/v1/course-imports/${jobId}/source`,
      {
        method: "POST",
        body: JSON.stringify({
          file_name: file.name,
          media_type: file.type,
          content_base64: await fileBase64(file),
        }),
      },
    );
    endAiTask("ok");
    return job;
  } catch (cause) {
    // A rejected wave still settles the counter — and must not be announced
    // as a completed import when the panel has no result to show.
    endAiTask("failed");
    throw cause;
  }
}

export async function pendingCourseImports(
  semesterId: string,
): Promise<CourseImportJob[]> {
  const token = await synchronizeAuthenticatedData();
  return call<CourseImportJob[]>(
    token,
    `/api/v1/course-imports?semester_id=${encodeURIComponent(semesterId)}`,
  );
}

export async function startCourseImport(
  semesterId: string,
  file: File,
): Promise<CourseImportJob> {
  const token = await synchronizeAuthenticatedData();
  const job = await call<CourseImportJob>(token, "/api/v1/course-imports", {
    method: "POST",
    body: JSON.stringify({
      semester_id: semesterId,
      source_type: fileSourceType(file),
    }),
  });
  return uploadSource(token, job.id, file);
}

export async function retryCourseImport(
  jobId: string,
  file: File,
): Promise<CourseImportJob> {
  fileSourceType(file);
  const token = await synchronizeAuthenticatedData();
  return uploadSource(token, jobId, file);
}

export async function resolveImportedCourse(
  jobId: string,
  resolution: CourseImportResolution,
): Promise<CourseImportJob> {
  const token = await synchronizeAuthenticatedData();
  return call<CourseImportJob>(
    token,
    `/api/v1/course-imports/${jobId}/resolve-course`,
    {
      method: "POST",
      body: JSON.stringify(courseImportResolutionSchema.parse(resolution)),
    },
  );
}

export async function discardCourseImport(jobId: string): Promise<void> {
  const token = await synchronizeAuthenticatedData();
  await call<{ id: string }>(token, `/api/v1/course-imports/${jobId}`, {
    method: "DELETE",
  });
}

export async function commitCourseImport(
  jobId: string,
): Promise<CourseImportCommitResult> {
  // The commit runs server-side to completion even if the user navigates
  // away; both stores exist so the shell keeps showing progress and a
  // returning panel keeps showing its in-flight state.
  beginCourseCommit(jobId);
  const endAiTask = beginAiTask("course-commit");
  try {
    const token = await synchronizeAuthenticatedData();
    const result = await call<CourseImportCommitResult>(
      token,
      `/api/v1/course-imports/${jobId}/commit`,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
    await synchronizeAuthenticatedData();
    endAiTask("ok");
    return result;
  } catch (cause) {
    endAiTask("failed");
    throw cause;
  } finally {
    endCourseCommit(jobId);
  }
}
