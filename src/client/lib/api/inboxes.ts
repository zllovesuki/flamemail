import {
  ExtendInboxRequest,
  ExtendInboxResponse,
  InboxInfo,
  OkResponse,
  WebSocketTicketResponse,
  type TempMailboxTtlHours,
} from "@/shared/contracts";
import { getInboxBookmarkScope } from "./bookmarks";
import { encodeJsonBody, request } from "./http";
import type { AuthDescriptor } from "./shared";

function buildInboxPath(address: string, suffix: string, auth: AuthDescriptor) {
  const base = `/api/protected/inboxes/${encodeURIComponent(address)}${suffix}`;
  return auth.mode === "admin" ? `${base}${suffix.includes("?") ? "&" : "?"}admin=1` : base;
}

function bearerToken(auth: AuthDescriptor) {
  return auth.mode === "user" ? auth.token : undefined;
}

export async function getInbox(address: string, auth: AuthDescriptor) {
  return request(buildInboxPath(address, "", auth), InboxInfo, {
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function deleteInbox(address: string, auth: AuthDescriptor) {
  return request(buildInboxPath(address, "", auth), OkResponse, {
    method: "DELETE",
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function extendInbox(address: string, auth: AuthDescriptor, ttlHours: TempMailboxTtlHours) {
  return request(buildInboxPath(address, "/extend", auth), ExtendInboxResponse, {
    method: "POST",
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
    body: encodeJsonBody(ExtendInboxRequest, { ttlHours }),
  });
}

export async function createWebSocketTicket(address: string, auth: AuthDescriptor) {
  return request(buildInboxPath(address, "/ws-ticket", auth), WebSocketTicketResponse, {
    method: "POST",
    token: bearerToken(auth),
    bookmarkScope: getInboxBookmarkScope(address),
  });
}
