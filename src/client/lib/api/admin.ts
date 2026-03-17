import {
  AdminDomainRequest,
  AdminDomainStatusRequest,
  AdminDomainsResponse,
  AdminInboxesResponse,
  AdminTempInboxPage,
  OkResponse,
} from "@/shared/contracts";
import { ADMIN_BOOKMARK_SCOPE } from "./shared";
import { encodeJsonBody, request } from "./http";

export async function listAdminInboxes(token: string) {
  const response = await request("/api/protected/admin/inboxes", AdminInboxesResponse, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.inboxes;
}

export async function listAdminDomains(token: string) {
  const response = await request("/api/protected/admin/domains", AdminDomainsResponse, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.domains;
}

export async function listAdminTempInboxes(token: string, page = 0, hasEmails = false) {
  const params = new URLSearchParams({ page: String(page) });
  if (hasEmails) {
    params.set("hasEmails", "true");
  }

  return request(`/api/protected/admin/temp-inboxes?${params.toString()}`, AdminTempInboxPage, {
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}

export async function addAdminDomain(token: string, domain: string, isActive = true) {
  const response = await request("/api/protected/admin/domains", AdminDomainsResponse, {
    method: "POST",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainRequest, { domain, isActive }),
  });
  return response.domains;
}

export async function updateAdminDomain(token: string, domain: string, isActive: boolean) {
  return request(`/api/protected/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "PATCH",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainStatusRequest, { isActive }),
  });
}

export async function deleteAdminDomain(token: string, domain: string) {
  return request(`/api/protected/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "DELETE",
    token,
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}
