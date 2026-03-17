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

export async function getInbox(address: string, token: string) {
  return request(`/api/protected/inboxes/${encodeURIComponent(address)}`, InboxInfo, {
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function deleteInbox(address: string, token: string) {
  return request(`/api/protected/inboxes/${encodeURIComponent(address)}`, OkResponse, {
    method: "DELETE",
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}

export async function extendInbox(address: string, token: string, ttlHours: TempMailboxTtlHours) {
  return request(`/api/protected/inboxes/${encodeURIComponent(address)}/extend`, ExtendInboxResponse, {
    method: "POST",
    token,
    bookmarkScope: getInboxBookmarkScope(address),
    body: encodeJsonBody(ExtendInboxRequest, { ttlHours }),
  });
}

export async function createWebSocketTicket(address: string, token: string) {
  return request(`/api/protected/inboxes/${encodeURIComponent(address)}/ws-ticket`, WebSocketTicketResponse, {
    method: "POST",
    token,
    bookmarkScope: getInboxBookmarkScope(address),
  });
}
