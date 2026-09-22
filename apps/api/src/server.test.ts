import { expect, it } from "vitest";
import { buildServer } from "./server.js";

it("serves the public health contract without database or auth configuration", async () => {
  const server = buildServer();
  const response = await server.inject("/api/v1/health");
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: { status: "ok" }, meta: {} });
  await server.close();
});
