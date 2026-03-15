import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const ADMIN_ACCESS_DISABLED_ERROR_CODE = "ADMIN_ACCESS_DISABLED" as const;
export const AdminAccessDisabledErrorCode = eg.literal(ADMIN_ACCESS_DISABLED_ERROR_CODE);
export type AdminAccessDisabledErrorCode = TypeFromCodec<typeof AdminAccessDisabledErrorCode>;

export const NullableString = eg.union([eg.string, eg.null]);
export type NullableString = TypeFromCodec<typeof NullableString>;

export const NullableNumber = eg.union([eg.number, eg.null]);
export type NullableNumber = TypeFromCodec<typeof NullableNumber>;

export const TurnstileToken = eg.string;
export type TurnstileToken = TypeFromCodec<typeof TurnstileToken>;

export const OkResponse = eg.object({
  ok: eg.boolean,
});
export type OkResponse = TypeFromCodec<typeof OkResponse>;

export const ErrorResponse = eg.object({
  code: AdminAccessDisabledErrorCode.optional,
  error: eg.string.optional,
});
export type ErrorResponse = TypeFromCodec<typeof ErrorResponse>;

export const TokenResponse = eg.object({
  token: eg.string,
});
export type TokenResponse = TypeFromCodec<typeof TokenResponse>;

export const WebSocketTicketResponse = eg.object({
  ticket: eg.string,
});
export type WebSocketTicketResponse = TypeFromCodec<typeof WebSocketTicketResponse>;

export const DomainsResponse = eg.object({
  domains: eg.array(eg.string),
});
export type DomainsResponse = TypeFromCodec<typeof DomainsResponse>;

export const PublicConfigResponse = eg.object({
  turnstileSiteKey: eg.string,
});
export type PublicConfigResponse = TypeFromCodec<typeof PublicConfigResponse>;
