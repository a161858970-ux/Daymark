import { Daymark, SyncWorker } from "@daymark/application";
import { DexieLocalRepository } from "@daymark/storage";
import { HttpSyncTransport } from "./syncTransport.js";

export const localRepository = new DexieLocalRepository();
export const daymark = new Daymark(localRepository);

export function createSyncWorker(
  accessToken: () => Promise<string>,
): SyncWorker {
  return new SyncWorker(localRepository, new HttpSyncTransport(accessToken));
}
