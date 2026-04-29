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

export async function listAdminInboxes() {
  const response = await request("/api/protected/admin/inboxes", AdminInboxesResponse, {
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.inboxes;
}

export async function listAdminDomains() {
  const response = await request("/api/protected/admin/domains", AdminDomainsResponse, {
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
  return response.domains;
}

export async function listAdminTempInboxes(page = 0, hasEmails = false) {
  const params = new URLSearchParams({ page: String(page) });
  if (hasEmails) {
    params.set("hasEmails", "true");
  }

  return request(`/api/protected/admin/temp-inboxes?${params.toString()}`, AdminTempInboxPage, {
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}

export async function addAdminDomain(domain: string, isActive = true) {
  const response = await request("/api/protected/admin/domains", AdminDomainsResponse, {
    method: "POST",
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainRequest, { domain, isActive }),
  });
  return response.domains;
}

export async function updateAdminDomain(domain: string, isActive: boolean) {
  return request(`/api/protected/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "PATCH",
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
    body: encodeJsonBody(AdminDomainStatusRequest, { isActive }),
  });
}

export async function deleteAdminDomain(domain: string) {
  return request(`/api/protected/admin/domains/${encodeURIComponent(domain)}`, OkResponse, {
    method: "DELETE",
    bookmarkScope: ADMIN_BOOKMARK_SCOPE,
  });
}
