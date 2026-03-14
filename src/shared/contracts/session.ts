import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const UserSession = eg.object({
  type: eg.literal("user"),
  address: eg.string,
});
export type UserSession = TypeFromCodec<typeof UserSession>;

export const AdminSession = eg.object({
  type: eg.literal("admin"),
});
export type AdminSession = TypeFromCodec<typeof AdminSession>;

export const SessionRecord = eg.union([UserSession, AdminSession]);
export type SessionRecord = TypeFromCodec<typeof SessionRecord>;

export const WebSocketTicketRecord = eg.object({
  address: eg.string,
  session: SessionRecord,
});
export type WebSocketTicketRecord = TypeFromCodec<typeof WebSocketTicketRecord>;
