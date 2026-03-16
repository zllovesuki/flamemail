import { nanoid } from "nanoid";
import type { SessionRecord } from "@/shared/contracts";
import { decodeWebSocketTicket } from "@/worker/security";
import { WEBSOCKET_TICKET_TTL_MS } from "./shared";

function getSessionTokenKey(token: string) {
  return `token:${token}`;
}

function getInboxTokenLookupKey(address: string) {
  return `inbox-token:${address}`;
}

async function persistSessionToken(env: Env, token: string, session: SessionRecord, expirationTtl: number) {
  await env.SESSIONS.put(getSessionTokenKey(token), JSON.stringify(session), {
    expirationTtl,
  });

  if (session.type === "user") {
    await env.SESSIONS.put(getInboxTokenLookupKey(session.address), token, {
      expirationTtl,
    });
  }
}

export async function refreshSessionToken(env: Env, token: string, session: SessionRecord, expiresAt: Date) {
  const ttlMs = expiresAt.getTime() - Date.now();
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000));

  await persistSessionToken(env, token, session, expirationTtl);
}

export async function createSessionToken(env: Env, session: SessionRecord, ttlMs: number) {
  const token = `tok_${nanoid(32)}`;
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000));

  await persistSessionToken(env, token, session, expirationTtl);

  return token;
}

export async function revokeInboxSessionToken(env: Env, address: string) {
  const lookupKey = getInboxTokenLookupKey(address);
  const token = await env.SESSIONS.get(lookupKey);

  await Promise.all([
    env.SESSIONS.delete(lookupKey),
    ...(token ? [env.SESSIONS.delete(getSessionTokenKey(token))] : []),
  ]);
}

export async function createWebSocketTicket(env: Env, address: string, session: SessionRecord) {
  const ticket = `wst_${nanoid(24)}`;

  await env.SESSIONS.put(`ws-ticket:${ticket}`, JSON.stringify({ address, session }), {
    expirationTtl: Math.max(30, Math.ceil(WEBSOCKET_TICKET_TTL_MS / 1000)),
  });

  return ticket;
}

export async function consumeWebSocketTicket(env: Env, ticket: string | null | undefined) {
  if (!ticket) {
    return null;
  }

  const key = `ws-ticket:${ticket}`;
  const raw = await env.SESSIONS.get(key);
  if (!raw) {
    return null;
  }

  await env.SESSIONS.delete(key);
  return decodeWebSocketTicket(raw);
}
