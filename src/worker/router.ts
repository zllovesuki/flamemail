import { Hono } from "hono";
import { ErrorResponse } from "@/shared/contracts";
import { D1_BOOKMARK_HEADER } from "@/shared/d1";
import { registerAdminRoutes } from "@/worker/api/admin";
import { registerConfigRoutes } from "@/worker/api/config";
import { registerDomainRoutes } from "@/worker/api/domains";
import { registerEmailRoutes } from "@/worker/api/emails";
import { registerInboxRoutes } from "@/worker/api/inboxes";
import { createDb } from "@/worker/db";
import { createLogger, errorContext } from "@/worker/logger";
import type { AppBindings } from "@/worker/types";

export const app = new Hono<AppBindings>();
const logger = createLogger("router");

const REPLICA_FRIENDLY_ROUTES = [
  /^\/api\/public\/config$/,
  /^\/api\/public\/domains$/,
  /^\/api\/protected\/inboxes\/[^/]+$/,
  /^\/api\/protected\/inboxes\/[^/]+\/emails$/,
  /^\/api\/protected\/inboxes\/[^/]+\/emails\/[^/]+\/raw$/,
  /^\/api\/protected\/inboxes\/[^/]+\/emails\/[^/]+\/attachments\/[^/]+$/,
  /^\/api\/protected\/admin\/domains$/,
  /^\/api\/protected\/admin\/inboxes$/,
  /^\/api\/protected\/admin\/temp-inboxes$/,
];

function selectSessionConstraint(method: string, path: string): D1SessionConstraint {
  if (method === "GET" && REPLICA_FRIENDLY_ROUTES.some((route) => route.test(path))) {
    return "first-unconstrained";
  }

  return "first-primary";
}

app.use("*", async (c, next) => {
  const bookmark = c.req.header(D1_BOOKMARK_HEADER)?.trim();
  const session = bookmark
    ? c.env.DB.withSession(bookmark)
    : c.env.DB.withSession(selectSessionConstraint(c.req.method, c.req.path));

  c.set("db", createDb(session));

  await next();

  const nextBookmark = session.getBookmark();
  if (nextBookmark) {
    c.header(D1_BOOKMARK_HEADER, nextBookmark);
  }
});

registerConfigRoutes(app);
registerDomainRoutes(app);
registerInboxRoutes(app);
registerEmailRoutes(app);
registerAdminRoutes(app);

app.notFound((c) => c.json(ErrorResponse.create({ error: "Not found" }), 404));

app.onError((error, c) => {
  logger.error("request_failed", "Unhandled API error", {
    method: c.req.method,
    path: c.req.path,
    ...errorContext(error),
  });
  return c.json(
    ErrorResponse.create({
      error: "Internal server error",
    }),
    500,
  );
});
