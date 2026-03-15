import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMAIL_PAGE_SIZE,
  deleteEmail as deleteEmailRequest,
  getEmail,
  getErrorMessage,
  getInbox,
  listEmails,
  type EmailDetail,
  type EmailSummary,
  type InboxInfo,
} from "../lib/api";

interface SessionTarget {
  address: string;
  token: string;
}

interface UseInboxOptions {
  markReadOnOpen?: boolean;
}

export function useInbox(session: SessionTarget | null, options: UseInboxOptions = {}) {
  const address = session?.address ?? null;
  const token = session?.token ?? null;
  const markReadOnOpen = options.markReadOnOpen ?? true;

  const [inbox, setInbox] = useState<InboxInfo | null>(null);
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedEmailIdRef = useRef(selectedEmailId);
  const selectedEmailRef = useRef(selectedEmail);
  selectedEmailIdRef.current = selectedEmailId;
  selectedEmailRef.current = selectedEmail;

  const markEmailRead = useCallback(
    (emailId: string) => {
      if (!markReadOnOpen) {
        return;
      }

      setEmails((current) => current.map((item) => (item.id === emailId ? { ...item, isRead: true } : item)));
    },
    [markReadOnOpen],
  );

  const loadEmailDetail = useCallback(
    async (emailId: string) => {
      if (!address || !token || !emailId) {
        setSelectedEmail(null);
        return null;
      }

      setEmailLoading(true);

      try {
        const detail = await getEmail(address, emailId, token);
        setSelectedEmail(detail);
        markEmailRead(emailId);
        return detail;
      } finally {
        setEmailLoading(false);
      }
    },
    [address, markEmailRead, token],
  );

  const refreshInbox = useCallback(async () => {
    if (!address || !token) {
      setInbox(null);
      return null;
    }

    const inboxInfo = await getInbox(address, token);
    setInbox(inboxInfo);
    return inboxInfo;
  }, [address, token]);

  const refreshEmails = useCallback(
    async ({
      includeTotal = false,
      refreshSelected = false,
    }: { includeTotal?: boolean; refreshSelected?: boolean } = {}) => {
      if (!address || !token) {
        setEmails([]);
        setSelectedEmail(null);
        setSelectedEmailId(null);
        return null;
      }

      const emailPage = await listEmails(address, token, {
        includeTotal,
      });

      setEmails(emailPage.emails);

      const previousId = selectedEmailIdRef.current;
      const nextSelectedId = emailPage.emails.some((item) => item.id === previousId)
        ? previousId
        : (emailPage.emails[0]?.id ?? null);

      setSelectedEmailId(nextSelectedId);

      if (!nextSelectedId) {
        setSelectedEmail(null);
        return emailPage;
      }

      const shouldRefreshSelected =
        refreshSelected || nextSelectedId !== previousId || selectedEmailRef.current?.id !== nextSelectedId;

      if (shouldRefreshSelected) {
        await loadEmailDetail(nextSelectedId);
      }

      return emailPage;
    },
    [address, loadEmailDetail, token],
  );

  const selectEmail = useCallback(
    async (emailId: string) => {
      if (!address || !token) {
        return;
      }

      if (!emailId) {
        setSelectedEmailId(null);
        setSelectedEmail(null);
        return;
      }

      setSelectedEmailId(emailId);
      setError(null);

      try {
        await loadEmailDetail(emailId);
      } catch (nextError) {
        setError(getErrorMessage(nextError));
      }
    },
    [address, loadEmailDetail, token],
  );

  const refresh = useCallback(async () => {
    if (!address || !token) {
      setInbox(null);
      setEmails([]);
      setSelectedEmail(null);
      setSelectedEmailId(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await refreshInbox();
      await refreshEmails({
        refreshSelected: true,
      });
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
      setEmailLoading(false);
    }
  }, [address, refreshEmails, refreshInbox, token]);

  const deleteEmail = useCallback(
    async (emailId: string) => {
      if (!address || !token) {
        return;
      }

      setError(null);

      try {
        await deleteEmailRequest(address, emailId, token);
        await refreshEmails({ refreshSelected: selectedEmailIdRef.current === emailId });
      } catch (nextError) {
        setError(getErrorMessage(nextError));
      }
    },
    [address, refreshEmails, token],
  );

  const applyIncomingEmail = useCallback(
    async (email: EmailSummary) => {
      setEmails((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== email.id);
        return [email, ...withoutDuplicate].slice(0, Math.max(current.length, EMAIL_PAGE_SIZE));
      });

      if (!selectedEmailIdRef.current) {
        setSelectedEmailId(email.id);

        try {
          setError(null);
          await loadEmailDetail(email.id);
        } catch (nextError) {
          setError(getErrorMessage(nextError));
        }
      }
    },
    [loadEmailDetail],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    inbox,
    emails,
    selectedEmail,
    selectedEmailId,
    loading,
    emailLoading,
    error,
    refreshInbox,
    refreshEmails,
    refresh,
    selectEmail,
    deleteEmail,
    applyIncomingEmail,
  };
}
