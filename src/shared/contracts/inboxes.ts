import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import { NullableString, TurnstileToken } from "./common";

export const TEMP_MAILBOX_TTL_HOURS = [24, 48, 72] as const;
export type TempMailboxTtlHours = (typeof TEMP_MAILBOX_TTL_HOURS)[number];

const TempMailboxTtlHoursCodecs = TEMP_MAILBOX_TTL_HOURS.map((hours) => eg.literal(hours));
export const TempMailboxTtlHours = eg.union([
  TempMailboxTtlHoursCodecs[0],
  TempMailboxTtlHoursCodecs[1],
  TempMailboxTtlHoursCodecs[2],
]);

const NullableTempMailboxTtlHours = eg.union([TempMailboxTtlHours, eg.null]);

export const CreateInboxRequest = eg.object({
  domain: eg.string,
  ttlHours: TempMailboxTtlHours,
  turnstileToken: TurnstileToken,
});
export type CreateInboxRequest = TypeFromCodec<typeof CreateInboxRequest>;

export const InboxSession = eg.object({
  address: eg.string,
  token: eg.string,
  ttlHours: TempMailboxTtlHours,
  expiresAt: eg.string,
});
export type InboxSession = TypeFromCodec<typeof InboxSession>;

export const CreateInboxResponse = InboxSession;
export type CreateInboxResponse = InboxSession;

export const InboxSessionSummary = eg.object({
  address: eg.string,
  ttlHours: TempMailboxTtlHours,
  expiresAt: eg.string,
});
export type InboxSessionSummary = TypeFromCodec<typeof InboxSessionSummary>;

export const InboxSessionSummaryList = eg.array(InboxSessionSummary);
export type InboxSessionSummaryList = TypeFromCodec<typeof InboxSessionSummaryList>;

export const InboxInfo = eg.object({
  address: eg.string,
  isPermanent: eg.boolean,
  ttlHours: NullableTempMailboxTtlHours,
  expiresAt: NullableString,
  createdAt: eg.string,
});
export type InboxInfo = TypeFromCodec<typeof InboxInfo>;

export const ExtendInboxRequest = eg.object({
  ttlHours: TempMailboxTtlHours,
});
export type ExtendInboxRequest = TypeFromCodec<typeof ExtendInboxRequest>;

export const ExtendInboxResponse = eg.object({
  address: eg.string,
  ttlHours: TempMailboxTtlHours,
  expiresAt: eg.string,
});
export type ExtendInboxResponse = TypeFromCodec<typeof ExtendInboxResponse>;
