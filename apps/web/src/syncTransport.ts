import type { OutboxMutation } from "@daymark/domain";
import type { SyncConflict } from "@daymark/domain";
import type { ConflictResolution } from "@daymark/contracts";
import { apiBase } from "./apiBase.js";
import type {
  PushResult,
  RemoteChange,
  SyncTransport,
} from "@daymark/application";

export class SyncHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ConflictDetail {
  conflict: SyncConflict;
  current_entity: Record<string, unknown>;
}

export interface ResolvedConflict {
  conflict: SyncConflict;
  entity: Record<string, unknown>;
  undo_token?: string;
  undo_expires_at?: string;
}

/** Authentication is supplied by the account/session layer; no token is persisted here. */
export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly baseUrl = `${apiBase()}/api/v1`,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json()) as {
      data?: T;
      meta?: Record<string, unknown>;
      error?: { code: string; message: string };
    };
    if (!response.ok)
      throw new SyncHttpError(
        body.error?.code ?? "SERVER_ERROR",
        body.error?.message ?? "Sync request failed",
        response.status,
      );
    return body as T;
  }

  async identity(): Promise<string> {
    const response = await this.request<{ data: { owner_id: string } }>(
      "/sync/identity",
    );
    return response.data.owner_id;
  }

  async push(deviceId: string, mutation: OutboxMutation): Promise<PushResult> {
    const response = await this.request<{ data: PushResult[] }>("/sync/push", {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceId,
        mutations: [
          {
            mutation_id: mutation.mutation_id,
            entity_type: mutation.entity_type,
            entity_id: mutation.entity_id,
            operation: mutation.operation,
            base_version: mutation.base_version,
            changed_fields: mutation.changed_fields,
          },
        ],
      }),
    });
    return response.data[0]!;
  }

  async changes(cursor: string | null): Promise<{
    data: RemoteChange[];
    next_cursor: string;
    has_more: boolean;
  }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await this.request<{
      data: RemoteChange[];
      meta: { next_cursor: string; has_more: boolean };
    }>(`/sync/changes${query}`);
    return { data: response.data, ...response.meta };
  }

  async conflicts(): Promise<SyncConflict[]> {
    const response = await this.request<{ data: SyncConflict[] }>(
      "/sync/conflicts",
    );
    return response.data;
  }

  async conflict(id: string): Promise<ConflictDetail> {
    const response = await this.request<{ data: ConflictDetail }>(
      `/sync/conflicts/${encodeURIComponent(id)}`,
    );
    return response.data;
  }

  async resolveConflict(
    id: string,
    version: number,
    resolution: ConflictResolution,
    mutationId = crypto.randomUUID(),
  ): Promise<ResolvedConflict> {
    const response = await this.request<{ data: ResolvedConflict }>(
      `/sync/conflicts/${encodeURIComponent(id)}/resolve`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": mutationId,
          "If-Match": String(version),
        },
        body: JSON.stringify(resolution),
      },
    );
    return response.data;
  }
}
