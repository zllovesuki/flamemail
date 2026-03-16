import { InboxInfo } from "@/shared/contracts";
import type { InboxRecord } from "@/worker/types";
import { ttlHoursFromInbox } from "@/worker/services/inbox/shared";

export function toInboxInfo(inbox: InboxRecord) {
  return InboxInfo.create({
    address: inbox.fullAddress,
    isPermanent: inbox.isPermanent,
    ttlHours: ttlHoursFromInbox(inbox),
    expiresAt: inbox.expiresAt?.toISOString() ?? null,
    createdAt: inbox.createdAt.toISOString(),
  });
}
