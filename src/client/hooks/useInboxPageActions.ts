import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/client/components/toast";
import {
  TEMP_MAILBOX_TTL_HOURS,
  deleteInbox,
  extendInbox,
  getErrorMessage,
  removeInboxSession,
  updateInboxSession,
  type InboxInfo,
  type TempMailboxTtlHours,
} from "@/client/lib/api";

interface SessionTarget {
  address: string;
  token: string;
}

interface UseInboxPageActionsOptions {
  address: string;
  adminMode: boolean;
  inbox: InboxInfo | null;
  onDeleted: (address: string) => void;
  refreshInbox: () => Promise<InboxInfo | null>;
  selectEmail: (emailId: string) => Promise<void> | void;
  session: SessionTarget | null;
}

export function useInboxPageActions({
  address,
  adminMode,
  inbox,
  onDeleted,
  refreshInbox,
  selectEmail,
  session,
}: UseInboxPageActionsOptions) {
  const navigate = useNavigate();
  const [extendingTo, setExtendingTo] = useState<TempMailboxTtlHours | null>(null);

  const availableExtensions = useMemo(() => {
    if (!inbox || inbox.isPermanent || !inbox.ttlHours) {
      return [] as TempMailboxTtlHours[];
    }

    const currentTtlHours = inbox.ttlHours;
    return TEMP_MAILBOX_TTL_HOURS.filter((hours) => hours > currentTtlHours);
  }, [inbox]);

  const isAdminInspectingTemporaryInbox = adminMode && inbox !== null && !inbox.isPermanent;
  const canDeleteEmail = !adminMode || inbox?.isPermanent === true;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied to clipboard");
    } catch {
      toast.error("Could not copy the inbox address.");
    }
  };

  const handleDeleteInbox = async () => {
    if (!session || !inbox || inbox.isPermanent) {
      return;
    }

    const confirmed = window.confirm(
      adminMode
        ? `Admin delete ${address} and all stored email? This cannot be undone.`
        : `Delete ${address} and all stored email?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteInbox(address, session.token);
      removeInboxSession(address);
      onDeleted(address);
      toast.success("Inbox deleted");
      navigate(adminMode ? "/admin" : "/");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleExtendInbox = async (ttlHours: TempMailboxTtlHours) => {
    if (!session || !inbox || inbox.isPermanent) {
      return;
    }

    setExtendingTo(ttlHours);

    try {
      const updated = await extendInbox(address, session.token, ttlHours);
      updateInboxSession(address, {
        expiresAt: updated.expiresAt,
        ttlHours: updated.ttlHours,
      });
      await refreshInbox();
      toast.success(`Inbox extended to ${ttlHours}h`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setExtendingTo(null);
    }
  };

  const handleBackToList = () => {
    void selectEmail("");
  };

  return {
    availableExtensions,
    canDeleteEmail,
    extendingTo,
    isAdminInspectingTemporaryInbox,
    handleBackToList,
    handleCopy,
    handleDeleteInbox,
    handleExtendInbox,
  };
}
