import { relations } from "drizzle-orm";
import { attachments, emails, inboxes } from "@/worker/db/schema";

export const inboxesRelations = relations(inboxes, ({ many }) => ({
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ many, one }) => ({
  inbox: one(inboxes, {
    fields: [emails.inboxId],
    references: [inboxes.id],
  }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  email: one(emails, {
    fields: [attachments.emailId],
    references: [emails.id],
  }),
}));
