import { EmailDetail, NewEmailNotification } from "@/shared/contracts";
import { emails } from "@/worker/db/schema";

type EmailSummarySource = Pick<
  typeof emails.$inferSelect,
  | "id"
  | "recipientAddress"
  | "fromAddress"
  | "fromName"
  | "subject"
  | "receivedAt"
  | "isRead"
  | "hasAttachments"
  | "sizeBytes"
>;

interface EmailAttachmentLike {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
}

interface EmailDetailSource extends EmailSummarySource {
  attachments: EmailAttachmentLike[];
}

export function toEmailSummary(email: EmailSummarySource) {
  return {
    id: email.id,
    recipientAddress: email.recipientAddress,
    fromAddress: email.fromAddress,
    fromName: email.fromName,
    subject: email.subject ?? "(no subject)",
    receivedAt: email.receivedAt.toISOString(),
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
    sizeBytes: email.sizeBytes ?? 0,
  };
}

export function toEmailDetail(
  email: EmailDetailSource,
  body: { text: string | null; html: string | null },
  isRead: boolean,
) {
  return EmailDetail.create({
    ...toEmailSummary({ ...email, isRead }),
    text: body.text,
    html: body.html,
    attachments: email.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes ?? 0,
    })),
  });
}

export function toNewEmailNotification(email: EmailSummarySource) {
  return NewEmailNotification.create({
    email: {
      ...toEmailSummary(email),
    },
  });
}
