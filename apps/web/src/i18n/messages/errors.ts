import type { MessageTree } from "./types.js";

export const errorsZh: MessageTree = {
  emptyRecord: "记录内容不能为空。",
  courseContextUnavailable: "课程信息已不可用，请重新选择课程。",
  needItem: "请先选择要处理的事项。",
  alreadyResolved: "这条记录已经处理过了。",
  notFoundRecord: "这条记录已经不存在了。",
  emptyCourseInformation: "课程信息内容不能为空。",
  courseInformationNeedsCourse: "课程信息需要先选择课程。",
  objectMissing: "对象不存在或已被删除。",
  splitNeedsTwo: "拆分需要至少两条内容。",
  syncNotConfigured: "尚未配置账户同步。",
  aiUnavailable: "智能整理暂时不可用，请稍后重试。",
  aiInvalidOutput: "无法可靠识别该文件，请重新上传清晰文件。",
  importFailed: "课程表导入未能完成，文件已保留，请重试。",
  importInvalidSource: "课程表文件读取异常，请重新选择一次。",
  importTooLarge: "课程表文件需要在 15 MB 以内。",
  authRequired: "请先登录后再试。",
  rateLimited: "请求过于频繁，请稍后重试。",
  versionConflict: "这条内容已在其他设备更新，请刷新后重试。",
  network: "网络连接不可用，请稍后重试。",
  timeout: "请求超时，请稍后重试。",
  permission: "没有获得系统权限，请在系统设置中开启。",
  fallback: "操作未完成，请稍后重试。",
};

export const errorsEn: MessageTree = {
  emptyRecord: "This note can’t be empty.",
  courseContextUnavailable:
    "That course is no longer available. Please pick a course again.",
  needItem: "Choose a task to continue.",
  alreadyResolved: "This note has already been handled.",
  notFoundRecord: "This note no longer exists.",
  emptyCourseInformation: "Course info can’t be empty.",
  courseInformationNeedsCourse: "Pick a course before saving course info.",
  objectMissing: "This item is missing or was deleted.",
  splitNeedsTwo: "Splitting needs at least two entries.",
  syncNotConfigured: "Account sync isn’t set up yet.",
  aiUnavailable: "Smart capture is unavailable right now. Try again later.",
  aiInvalidOutput: "We couldn’t read this file reliably. Try a clearer upload.",
  importFailed:
    "Timetable import didn’t finish. The file is kept — please try again.",
  importInvalidSource:
    "Couldn’t read that timetable file. Please pick it again.",
  importTooLarge: "Timetable files must be 15 MB or smaller.",
  authRequired: "Please sign in and try again.",
  rateLimited: "Too many requests. Please slow down and retry.",
  versionConflict:
    "This content was updated on another device. Refresh and try again.",
  network: "No network connection. Please try again later.",
  timeout: "The request timed out. Please try again.",
  permission: "Permission is missing. Enable it in system settings.",
  fallback: "Something went wrong. Please try again.",
};
