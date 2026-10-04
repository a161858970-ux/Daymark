/**
 * Keeps the API alive when a pooled connection's socket drops.
 *
 * pg-pool emits `error` on the pool itself whenever an *idle* client's
 * connection dies — Supabase's pooler closing idle sockets, a laptop waking
 * on another network, a VPN reconnect. Node treats an `error` event with no
 * listener as uncaught and terminates the process, so without this handler a
 * single dropped socket takes the whole service down with
 * `Error: Connection terminated unexpectedly`; the pool already discards the
 * broken client, it only needs someone to listen.
 */
export interface PoolLike {
  on(event: "error", listener: (error: Error) => void): unknown;
}

export function surviveIdleDisconnects(
  pool: PoolLike,
  log: (message: string) => void = (message) => console.error(message),
): void {
  pool.on("error", (error) => log(`[DB_POOL] ${error.message}`));
}
