import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import { NullableString, TurnstileToken } from "./common";
import { TempMailboxTtlHours } from "./inboxes";

const NullableTempMailboxTtlHours = eg.union([TempMailboxTtlHours, eg.null]);

export const AdminLoginRequest = eg.object({
  password: eg.string,
  turnstileToken: TurnstileToken,
});
export type AdminLoginRequest = TypeFromCodec<typeof AdminLoginRequest>;

export const AdminDomainRequest = eg.object({
  domain: eg.string,
  isActive: eg.boolean.optional,
});
export type AdminDomainRequest = TypeFromCodec<typeof AdminDomainRequest>;

export const AdminDomainStatusRequest = eg.object({
  isActive: eg.boolean,
});
export type AdminDomainStatusRequest = TypeFromCodec<typeof AdminDomainStatusRequest>;

export const AdminDomain = eg.object({
  domain: eg.string,
  isActive: eg.boolean,
  createdAt: eg.string,
  inboxCount: eg.number,
  canDelete: eg.boolean,
});
export type AdminDomain = TypeFromCodec<typeof AdminDomain>;

export const AdminDomainsResponse = eg.object({
  domains: eg.array(AdminDomain),
});
export type AdminDomainsResponse = TypeFromCodec<typeof AdminDomainsResponse>;

export const AdminInbox = eg.object({
  address: eg.string,
  domain: eg.string,
  localPart: eg.string,
  emailCount: eg.number,
});
export type AdminInbox = TypeFromCodec<typeof AdminInbox>;

export const AdminInboxesResponse = eg.object({
  inboxes: eg.array(AdminInbox),
});
export type AdminInboxesResponse = TypeFromCodec<typeof AdminInboxesResponse>;

export const AdminTempInbox = eg.object({
  address: eg.string,
  domain: eg.string,
  createdAt: eg.string,
  expiresAt: NullableString,
  ttlHours: NullableTempMailboxTtlHours,
  emailCount: eg.number,
});
export type AdminTempInbox = TypeFromCodec<typeof AdminTempInbox>;

export const AdminTempInboxPage = eg.object({
  inboxes: eg.array(AdminTempInbox),
  page: eg.number,
  pageSize: eg.number,
  total: eg.number,
});
export type AdminTempInboxPage = TypeFromCodec<typeof AdminTempInboxPage>;
