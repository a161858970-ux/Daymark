/**
 * User-facing error language.
 *
 * The domain and API layers throw precise engineering messages on purpose;
 * the UI must still speak product language, so every surface maps a failure
 * through here before showing it. Internal concepts (mutation, row_version,
 * cursor, outbox, SQL, provider status codes) never reach the user.
 */
const known: [RegExp, string][] = [
  [/记录内容不能为空|Record cannot be empty/i, "记录内容不能为空。"],
  [/Course context is unavailable/i, "课程信息已不可用，请重新选择课程。"],
  [/Keeping one record requires an Item/i, "请先选择要处理的事项。"],
  [/Raw capture has already been resolved/i, "这条记录已经处理过了。"],
  [/Raw capture not found/i, "这条记录已经不存在了。"],
  [/Course information cannot be empty/i, "课程信息内容不能为空。"],
  [/Course information needs a course/i, "课程信息需要先选择课程。"],
  [
    /Course not found|Item not found|Semester not found|not found/i,
    "对象不存在或已被删除。",
  ],
  [/Split requires/i, "拆分需要至少两条内容。"],
  [/Account sync is not configured/i, "尚未配置账户同步。"],
  [
    /AI_UNAVAILABLE|Interpretation provider|智能整理/i,
    "智能整理暂时不可用，请稍后重试。",
  ],
  [
    /AI_INVALID_OUTPUT|无法可靠识别/i,
    "无法可靠识别该文件，请重新上传清晰文件。",
  ],
  [/IMPORT_FAILED/i, "课程表导入未能完成，文件已保留，请重试。"],
  [/Import source|15 MB/i, "课程表文件需要在 15 MB 以内。"],
  [/AUTH_REQUIRED|Authentication required|401/i, "请先登录后再试。"],
  [
    /VERSION_CONFLICT|row version|If-Match/i,
    "这条内容已在其他设备更新，请刷新后重试。",
  ],
  [
    /fetch failed|Failed to fetch|NetworkError|network request|ECONNREFUSED|offline|离线/i,
    "网络连接不可用，请稍后重试。",
  ],
  [/timeout|timed out/i, "请求超时，请稍后重试。"],
  [/Permission|permission/i, "没有获得系统权限，请在系统设置中开启。"],
];

/**
 * Returns product language for a failure. Chinese messages (already product
 * copy) pass through; anything unrecognised becomes a safe fallback.
 */
export function toUserMessage(
  cause: unknown,
  fallback = "操作未完成，请稍后重试。",
): string {
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : String(cause ?? "");
  const cleaned = raw.replace(/^Error:\s*/, "").trim();
  if (!cleaned) return fallback;
  if (/[一-鿿]/.test(cleaned)) return cleaned;
  for (const [pattern, message] of known)
    if (pattern.test(cleaned)) return message;
  return fallback;
}
