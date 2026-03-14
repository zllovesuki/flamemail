import type { Context } from "hono";
import type { SessionRecord } from "@/shared/contracts";
import type { Database } from "@/worker/db";
import type { inboxes } from "@/worker/db/schema";

export type InboxRecord = typeof inboxes.$inferSelect;

export interface AppVariables {
  db: Database;
  session: SessionRecord;
  token: string;
  inbox: InboxRecord;
}

export interface AppBindings {
  Bindings: Env;
  Variables: AppVariables;
}

export type AppContext = Context<AppBindings>;
