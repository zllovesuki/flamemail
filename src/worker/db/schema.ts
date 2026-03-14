import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull().unique(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("idx_domains_active").on(table.isActive)],
);

export const inboxes = sqliteTable(
  "inboxes",
  {
    id: text("id").primaryKey(),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    fullAddress: text("full_address").notNull().unique(),
    isPermanent: integer("is_permanent", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("idx_inboxes_local_domain").on(table.localPart, table.domain),
    index("idx_inboxes_domain").on(table.domain),
    index("idx_inboxes_permanent_expires").on(table.isPermanent, table.expiresAt),
    index("idx_inboxes_permanent_created").on(table.isPermanent, table.createdAt),
    index("idx_inboxes_permanent_domain_local").on(table.isPermanent, table.domain, table.localPart),
  ],
);

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    recipientAddress: text("recipient_address").notNull().default(""),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject").default("(no subject)"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    sizeBytes: integer("size_bytes").default(0),
    hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
    bodyKey: text("body_key"),
  },
  (table) => [index("idx_emails_inbox_received_id").on(table.inboxId, table.receivedAt, table.id)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    filename: text("filename"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes").default(0),
    storageKey: text("storage_key").notNull(),
  },
  (table) => [index("idx_attachments_email").on(table.emailId)],
);
