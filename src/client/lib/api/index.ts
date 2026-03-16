export { EMAIL_PAGE_SIZE, TEMP_MAILBOX_TTL_HOURS } from "@/shared/contracts";
export type {
  AdminDomain,
  AdminInbox,
  AdminTempInbox,
  AdminTempInboxPage as AdminTempInboxPage,
  EmailAttachment,
  EmailDetail as EmailDetail,
  EmailSummary,
  InboxInfo as InboxInfo,
  InboxSession as InboxSession,
  InboxSessionSummary as InboxSessionSummary,
  TempMailboxTtlHours,
} from "@/shared/contracts";

export * from "./admin";
export * from "./emails";
export * from "./errors";
export * from "./inboxes";
export * from "./public";
export * from "./session-storage";
