import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectLocalEmailEndpoint, resolveEndpoint } from "../../scripts/send-local-email.mjs";

const EMAIL_HANDLER_PATH = "/cdn-cgi/handler/email";
const PUBLIC_CONFIG_PATH = "/api/public/config";
const INVALID_EMAIL_RESPONSE =
  "Invalid email. Your request must include URL parameters specifying the `from` and `to` addresses, as well as an email in the body";
const FLAMEMAIL_INDEX_HTML = `<!doctype html><html><head><title>flamemail</title></head><body></body></html>`;
const openServers = new Set<Server>();

afterEach(async () => {
  await Promise.all([...openServers].map(closeServer));
  openServers.clear();
});

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function listenOnPort(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function createMockServer(candidatePorts: number[], responder: RequestListener) {
  for (const port of candidatePorts) {
    const server = createServer(responder);

    try {
      await listenOnPort(server, port);
      openServers.add(server);
      return { port, server };
    } catch (error) {
      await closeServer(server).catch(() => {});

      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not bind a mock email handler on ports: ${candidatePorts.join(", ")}`);
}

async function createMockFlamemailServer(candidatePorts: number[], options?: { configStatus?: 200 | 503 }) {
  const configStatus = options?.configStatus ?? 200;

  return createMockServer(candidatePorts, (request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (requestPath === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(FLAMEMAIL_INDEX_HTML);
      return;
    }

    if (requestPath === PUBLIC_CONFIG_PATH) {
      response.writeHead(configStatus, {
        "content-type": "application/json; charset=utf-8",
      });

      if (configStatus === 200) {
        response.end(JSON.stringify({ turnstileSiteKey: "1x00000000000000000000AA" }));
        return;
      }

      response.end(JSON.stringify({ error: "Human verification is temporarily unavailable." }));
      return;
    }

    if (requestPath === EMAIL_HANDLER_PATH) {
      response.writeHead(400, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(INVALID_EMAIL_RESPONSE);
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });
}

async function createMockGenericEmailServer(candidatePorts: number[]) {
  return createMockServer(candidatePorts, (request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (requestPath === EMAIL_HANDLER_PATH) {
      response.writeHead(400, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(INVALID_EMAIL_RESPONSE);
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });
}

describe("send-local-email endpoint detection", () => {
  it("finds a Flamemail dev server on a shifted vite-style port", async () => {
    const { port } = await createMockFlamemailServer([5184, 5185, 5186, 5187, 5188]);

    const endpoint = await detectLocalEmailEndpoint({
      candidatePorts: [port],
    });

    expect(endpoint).toBe(`http://127.0.0.1:${port}${EMAIL_HANDLER_PATH}`);
  });

  it("skips unrelated Cloudflare dev servers and finds Flamemail on a later port", async () => {
    const genericServer = await createMockGenericEmailServer([5189]);
    const flamemailServer = await createMockFlamemailServer([5190]);

    const endpoint = await detectLocalEmailEndpoint({
      candidatePorts: [genericServer.port, flamemailServer.port],
    });

    expect(endpoint).toBe(`http://127.0.0.1:${flamemailServer.port}${EMAIL_HANDLER_PATH}`);
  });

  it("accepts Flamemail config responses that fail closed with 503", async () => {
    const { port } = await createMockFlamemailServer([5191], { configStatus: 503 });

    const endpoint = await detectLocalEmailEndpoint({
      candidatePorts: [port],
    });

    expect(endpoint).toBe(`http://127.0.0.1:${port}${EMAIL_HANDLER_PATH}`);
  });

  it("prefers an explicit endpoint over auto detection", async () => {
    const detectEndpoint = vi.fn();
    const explicitEndpoint = "http://127.0.0.1:4173/cdn-cgi/handler/email";

    const endpoint = await resolveEndpoint(
      {
        dryRun: false,
        endpoint: explicitEndpoint,
      },
      { detectEndpoint },
    );

    expect(endpoint).toBe(explicitEndpoint);
    expect(detectEndpoint).not.toHaveBeenCalled();
  });

  it("skips endpoint detection during dry runs", async () => {
    const detectEndpoint = vi.fn();

    const endpoint = await resolveEndpoint(
      {
        dryRun: true,
        endpoint: "",
      },
      { detectEndpoint },
    );

    expect(endpoint).toBeNull();
    expect(detectEndpoint).not.toHaveBeenCalled();
  });

  it("reports checked ports when no local handler matches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }));

    await expect(
      detectLocalEmailEndpoint({
        candidatePorts: [5173, 5174],
        fetchImpl,
      }),
    ).rejects.toThrow(
      "Could not detect a local Flamemail dev server. Checked ports: 5173, 5174. Start npm run dev or pass --endpoint.",
    );
  });
});
