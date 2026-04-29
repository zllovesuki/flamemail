import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getInboxSession, type AuthDescriptor } from "@/client/lib/api";

interface InboxRouteSession {
  address: string;
  adminMode: boolean;
  auth: AuthDescriptor | null;
}

export function useInboxRouteSession(): InboxRouteSession {
  const params = useParams();
  const [searchParams] = useSearchParams();

  const address = useMemo(() => decodeURIComponent(params.address ?? ""), [params.address]);
  // Admin inspection is selected by explicit `?admin=1` only. The cookie
  // backing the admin session is httpOnly so the client cannot detect it
  // locally; admin pages link to inbox routes with `?admin=1` already, so
  // the only way to land in admin mode is through that explicit hint.
  const adminMode = searchParams.get("admin") === "1";

  if (!address) {
    return { address, adminMode, auth: null };
  }

  if (adminMode) {
    return { address, adminMode, auth: { mode: "admin" } };
  }

  const userSession = getInboxSession(address);
  if (!userSession) {
    return { address, adminMode, auth: null };
  }

  return {
    address,
    adminMode,
    auth: { mode: "user", token: userSession.token },
  };
}
