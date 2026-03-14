import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import { NullableNumber, NullableString } from "./common";

export const EMAIL_PAGE_SIZE = 20;

export const EmailSummary = eg.object({
  id: eg.string,
  recipientAddress: eg.string,
  fromAddress: eg.string,
  fromName: NullableString,
  subject: eg.string,
  receivedAt: eg.string,
  isRead: eg.boolean,
  hasAttachments: eg.boolean,
  sizeBytes: eg.number,
});
export type EmailSummary = TypeFromCodec<typeof EmailSummary>;

export const EmailAttachment = eg.object({
  id: eg.string,
  filename: NullableString,
  contentType: NullableString,
  sizeBytes: eg.number,
});
export type EmailAttachment = TypeFromCodec<typeof EmailAttachment>;

export const EmailDetail = eg.object({
  id: eg.string,
  recipientAddress: eg.string,
  fromAddress: eg.string,
  fromName: NullableString,
  subject: eg.string,
  receivedAt: eg.string,
  isRead: eg.boolean,
  hasAttachments: eg.boolean,
  sizeBytes: eg.number,
  text: NullableString,
  html: NullableString,
  attachments: eg.array(EmailAttachment),
});
export type EmailDetail = TypeFromCodec<typeof EmailDetail>;

export const EmailPage = eg.object({
  emails: eg.array(EmailSummary),
  total: NullableNumber,
  page: eg.number,
});
export type EmailPage = TypeFromCodec<typeof EmailPage>;

export const NewEmailEvent = eg.object({
  type: eg.literal("new_email"),
  email: EmailSummary,
});
export type NewEmailEvent = TypeFromCodec<typeof NewEmailEvent>;

export const NewEmailNotification = eg.omit(NewEmailEvent, ["type"]);
export type NewEmailNotification = TypeFromCodec<typeof NewEmailNotification>;
