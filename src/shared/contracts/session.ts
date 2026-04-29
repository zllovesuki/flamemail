import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const UserSession = eg.object({
  type: eg.literal("user"),
  address: eg.string,
});
export type UserSession = TypeFromCodec<typeof UserSession>;

export const AdminSession = eg.object({
  type: eg.literal("admin"),
  // The verified OIDC `sub` claim from tessera. Persisted in KV so
  // requireAdmin can re-check the operator allowlist on every request,
  // failing closed when an operator is removed from
  // TESSERA_OPERATOR_SUBS mid-session (instead of waiting for KV TTL).
  sub: eg.string,
});
export type AdminSession = TypeFromCodec<typeof AdminSession>;

export const SessionRecord = eg.union([UserSession, AdminSession]);
export type SessionRecord = TypeFromCodec<typeof SessionRecord>;

export const WebSocketTicketRecord = eg.object({
  address: eg.string,
  session: SessionRecord,
});
export type WebSocketTicketRecord = TypeFromCodec<typeof WebSocketTicketRecord>;
