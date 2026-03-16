import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "@/worker/index";
import { createWebSocketTicket } from "@/worker/services/inbox";
import { resetWorkerState, seedDomain, seedInbox } from "./api/helpers";

function websocketRequest(address: string, ticket?: string, origin = "https://flamemail.devbin.tools") {
  const url = new URL("https://flamemail.devbin.tools/ws");
  url.searchParams.set("address", address);
  if (ticket) {
    url.searchParams.set("ticket", ticket);
  }

  return new Request(url, {
    headers: {
      origin,
      upgrade: "websocket",
    },
  }) as Parameters<typeof worker.fetch>[0];
}

describe("worker websocket admission", () => {
  beforeEach(async () => {
    await resetWorkerState();
  });

  it("rejects websocket upgrades with an invalid origin", async () => {
    const response = await worker.fetch(
      websocketRequest("reader@mail.test", "wst_invalid", "https://evil.example"),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Forbidden");
  });

  it("rejects websocket upgrades with an invalid or missing ticket", async () => {
    const response = await worker.fetch(websocketRequest("reader@mail.test"), env, createExecutionContext());

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  it("rejects websocket upgrades when the inbox does not exist", async () => {
    const ticket = await createWebSocketTicket(env, "reader@mail.test", {
      type: "admin",
    });

    const response = await worker.fetch(websocketRequest("reader@mail.test", ticket), env, createExecutionContext());

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Inbox not found");
  });

  it("rejects websocket upgrades when a user session ticket targets another inbox", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });
    const ticket = await createWebSocketTicket(env, "reader@mail.test", {
      type: "user",
      address: "other@mail.test",
    });

    const response = await worker.fetch(websocketRequest("reader@mail.test", ticket), env, createExecutionContext());

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Forbidden");
  });

  it("accepts websocket upgrades for a valid one-time ticket", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });
    const ticket = await createWebSocketTicket(env, "reader@mail.test", {
      type: "user",
      address: "reader@mail.test",
    });

    const response = await worker.fetch(websocketRequest("reader@mail.test", ticket), env, createExecutionContext());

    expect(response.status).toBe(101);
    expect(await env.SESSIONS.get(`ws-ticket:${ticket}`)).toBeNull();
  });

  it("rejects reusing a consumed websocket ticket", async () => {
    await seedDomain("mail.test", true);
    await seedInbox({
      address: "reader@mail.test",
    });
    const ticket = await createWebSocketTicket(env, "reader@mail.test", {
      type: "admin",
    });

    const firstResponse = await worker.fetch(
      websocketRequest("reader@mail.test", ticket),
      env,
      createExecutionContext(),
    );
    const secondResponse = await worker.fetch(
      websocketRequest("reader@mail.test", ticket),
      env,
      createExecutionContext(),
    );

    expect(firstResponse.status).toBe(101);
    expect(secondResponse.status).toBe(401);
    await expect(secondResponse.text()).resolves.toBe("Unauthorized");
  });
});
