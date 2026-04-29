import {
  CreateInboxRequest,
  CreateInboxResponse,
  DomainsResponse,
  OkResponse,
  PublicConfigResponse,
  type TempMailboxTtlHours,
} from "@/shared/contracts";
import { getInboxBookmarkScope, setStoredBookmark } from "./bookmarks";
import { encodeJsonBody, request } from "./http";

let publicConfigPromise: Promise<{ turnstileSiteKey: string }> | null = null;

export async function listDomains() {
  const response = await request("/api/public/domains", DomainsResponse);
  return response.domains;
}

export async function getPublicConfig() {
  if (!publicConfigPromise) {
    publicConfigPromise = request("/api/public/config", PublicConfigResponse).catch((error) => {
      publicConfigPromise = null;
      throw error;
    });
  }

  return publicConfigPromise;
}

export async function createInbox(domain: string, ttlHours: TempMailboxTtlHours, turnstileToken: string) {
  let bookmark: string | null = null;
  const response = await request("/api/public/inboxes", CreateInboxResponse, {
    method: "POST",
    body: encodeJsonBody(CreateInboxRequest, { domain, ttlHours, turnstileToken }),
    onBookmark: (value) => {
      bookmark = value;
    },
  });

  if (bookmark) {
    setStoredBookmark(getInboxBookmarkScope(response.address), bookmark);
  }

  return response;
}

export function adminSignInUrl(): string {
  return "/api/public/admin/start";
}

export async function adminLogout() {
  return request("/api/public/admin/logout", OkResponse, {
    method: "POST",
  });
}
