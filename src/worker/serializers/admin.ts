import { AdminDomainsResponse } from "@/shared/contracts";

interface AdminDomainLike {
  domain: string;
  isActive: boolean;
  createdAt: Date;
  inboxCount: number;
  canDelete: boolean;
}

export function serializeAdminDomain(item: AdminDomainLike) {
  return {
    domain: item.domain,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    inboxCount: item.inboxCount,
    canDelete: item.canDelete,
  };
}

export function createAdminDomainsResponse(items: AdminDomainLike[]) {
  return AdminDomainsResponse.create({
    domains: items.map(serializeAdminDomain),
  });
}
