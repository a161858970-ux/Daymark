import { CourseManager, SyncWorker } from "@course-manager/application";
import { DexieLocalRepository } from "@course-manager/storage";
import { HttpSyncTransport } from "./syncTransport.js";

export const localRepository = new DexieLocalRepository();
export const courseManager = new CourseManager(localRepository);

export function createSyncWorker(
  accessToken: () => Promise<string>,
): SyncWorker {
  return new SyncWorker(localRepository, new HttpSyncTransport(accessToken));
}
