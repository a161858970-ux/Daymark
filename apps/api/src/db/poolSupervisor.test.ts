import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import { surviveIdleDisconnects } from "./poolSupervisor.js";

it("documents why the handler exists: a bare pool error kills the process", () => {
  const barePool = new EventEmitter();

  // This is the overnight outage: no listener means Node rethrows the event
  // as an uncaught exception.
  expect(() =>
    barePool.emit("error", new Error("Connection terminated unexpectedly")),
  ).toThrow("Connection terminated unexpectedly");
});

it("survives an idle connection drop and logs it", () => {
  const pool = new EventEmitter();
  const messages: string[] = [];
  surviveIdleDisconnects(pool, (message) => messages.push(message));

  expect(() =>
    pool.emit("error", new Error("Connection terminated unexpectedly")),
  ).not.toThrow();
  expect(messages).toEqual(["[DB_POOL] Connection terminated unexpectedly"]);
});
