import { drizzle } from "drizzle-orm/d1";
import * as relations from "@/worker/db/relations";
import * as schema from "@/worker/db/schema";

export type D1Client = D1Database | D1DatabaseSession;

export function createDb(d1: D1Client) {
  return drizzle(d1 as D1Database, {
    schema: {
      ...schema,
      ...relations,
    },
  });
}

export type Database = ReturnType<typeof createDb>;
