import { customAlphabet } from "nanoid";
import { TEMP_MAILBOX_TTL_HOURS, type TempMailboxTtlHours } from "@/shared/contracts";
import type { InboxRecord } from "@/worker/types";

export const createLocalPart = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
export const ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;
export const WEBSOCKET_TICKET_TTL_MS = 60 * 1000;
export const EXPIRED_INBOX_CLEANUP_BATCH_SIZE = 100;
export const RESERVED_ADDRESSES = ["admin", "postmaster", "abuse", "webmaster"] as const;
export const RESERVED_ADDRESS_VALUES = [...RESERVED_ADDRESSES];

export function hoursToMs(hours: number) {
  return hours * 60 * 60 * 1000;
}

export function normalizeDomainName(domainName: string) {
  return domainName.trim().toLowerCase();
}

export function isAllowedTempMailboxTtl(hours: number): hours is TempMailboxTtlHours {
  return TEMP_MAILBOX_TTL_HOURS.includes(hours as TempMailboxTtlHours);
}

export function ttlHoursFromInbox(inbox: InboxRecord) {
  if (!inbox.expiresAt) {
    return null;
  }

  const ttlHours = Math.round((inbox.expiresAt.getTime() - inbox.createdAt.getTime()) / hoursToMs(1));
  return isAllowedTempMailboxTtl(ttlHours) ? ttlHours : null;
}

export function computeInboxExpiry(createdAt: Date, ttlHours: TempMailboxTtlHours) {
  return new Date(createdAt.getTime() + hoursToMs(ttlHours));
}
