import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getAdminToken, getInboxSession } from "@/client/lib/api";

interface InboxRouteSession {
  address: string;
  adminMode: boolean;
  session: {
    address: string;
    token: string;
  } | null;
}

export function useInboxRouteSession(): InboxRouteSession {
  const params = useParams();
  const [searchParams] = useSearchParams();

  const address = useMemo(() => decodeURIComponent(params.address ?? ""), [params.address]);
  const userSession = address ? getInboxSession(address) : null;
  const adminToken = getAdminToken();
  const adminMode = searchParams.get("admin") === "1" || (!userSession && Boolean(adminToken));
  const token = adminMode ? adminToken : (userSession?.token ?? null);

  return {
    address,
    adminMode,
    session: token && address ? { address, token } : null,
  };
}
