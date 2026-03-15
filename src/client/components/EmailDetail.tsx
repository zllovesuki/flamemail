import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Lock, MailOpen, Shield, Trash2 } from "lucide-react";
import { toast } from "@/client/components/Toast";
import { prepareEmailHtml } from "@/client/lib/email-html";
import {
  downloadAttachment,
  getRawEmailSource,
  getErrorMessage,
  type EmailAttachment,
  type EmailDetail as EmailDetailType,
} from "@/client/lib/api";

interface EmailDetailProps {
  address: string;
  token: string;
  email: EmailDetailType | null;
  loading: boolean;
  canDelete: boolean;
  canViewRaw: boolean;
  onDelete: (emailId: string) => void;
}

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildSrcDoc(html: string, bodyAttributes = "", headHtml = "") {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="referrer" content="no-referrer" />
    <base target="_blank" />
    <style>
      html {
        background: transparent;
      }

      body {
        margin: 0;
        padding: 20px;
        background: transparent;
      }

      img {
        max-width: 100%;
        height: auto;
      }

      [data-remote-blocked="image"] {
        border: 1px dashed #52525b;
        border-radius: 12px;
        padding: 12px 14px;
        color: #a1a1aa;
        background: rgba(39, 39, 42, 0.5);
      }

      a {
        color: #fb923c;
      }
    </style>
    ${headHtml}
  </head>
  <body${bodyAttributes ? ` ${bodyAttributes}` : ""}>${html}</body>
</html>`;
}

export function EmailDetail({ address, token, email, loading, canDelete, canViewRaw, onDelete }: EmailDetailProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingRaw, setDownloadingRaw] = useState(false);
  const [allowRemoteContent, setAllowRemoteContent] = useState(false);

  useEffect(() => {
    setAllowRemoteContent(false);
  }, [email?.id]);

  const preparedHtml = useMemo(
    () => (email?.html ? prepareEmailHtml(email.html, allowRemoteContent) : null),
    [allowRemoteContent, email?.html, email?.id],
  );

  const handleDownload = async (attachment: EmailAttachment) => {
    if (!email) {
      return;
    }

    setDownloadingId(attachment.id);

    try {
      const blob = await downloadAttachment(address, email.id, attachment.id, token);
      const fileName = attachment.filename ?? "attachment.bin";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleViewRaw = async () => {
    if (!email) return;

    const rawWindow = window.open("about:blank", "_blank");
    if (!rawWindow) {
      toast.error("Browser blocked the raw source tab");
      return;
    }

    rawWindow.document.title = `Raw email ${email.id}`;
    rawWindow.document.body.textContent = "Loading raw source...";
    rawWindow.document.body.style.cssText = "margin:0;padding:16px;background:#0f172a;color:#cbd5e1;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;";
    rawWindow.document.documentElement.style.colorScheme = "dark";
    setDownloadingRaw(true);

    try {
      const rawSource = await getRawEmailSource(address, email.id, token);
      const pre = rawWindow.document.createElement("pre");
      pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;";
      pre.textContent = rawSource;
      rawWindow.document.body.textContent = "";
      rawWindow.document.body.appendChild(pre);
    } catch (error) {
      rawWindow.close();
      toast.error(getErrorMessage(error));
    } finally {
      setDownloadingRaw(false);
    }
  };

  if (loading && !email) {
    return (
      <section className="flex min-h-[560px] items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-6">
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading message...
        </div>
      </section>
    );
  }

  if (!email) {
    return (
      <section className="flex min-h-[560px] items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-grid h-14 w-14 place-items-center rounded-full bg-zinc-800/60">
            <MailOpen className="h-7 w-7 text-zinc-600" />
          </span>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-600">Viewer</span>
            <h2 className="text-lg font-semibold text-zinc-300">Select an email</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Pick a message from the list to view its contents.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[560px] flex-col rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      {/* Header */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold text-zinc-100">{email.subject}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {canViewRaw ? (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-flame-500/40 hover:bg-zinc-800/90 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-50"
                type="button"
                disabled={loading || downloadingRaw}
                onClick={() => void handleViewRaw()}
              >
                {downloadingRaw ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                View raw
              </button>
            ) : null}
            {canDelete ? (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:pointer-events-none disabled:opacity-50"
                type="button"
                disabled={loading}
                onClick={() => onDelete(email.id)}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-2.5 py-1 text-xs font-medium text-zinc-500">
                <Lock className="h-3 w-3" />
                Read-only
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">{email.fromName || email.fromAddress}</span>
          {email.fromName ? (
            <span className="ml-1 text-zinc-500">&lt;{email.fromAddress}&gt;</span>
          ) : null}
          <span className="mx-1.5 text-zinc-600">&middot;</span>
          {new Date(email.receivedAt).toLocaleString()}
          <span className="mx-1.5 text-zinc-600">&middot;</span>
          {formatSize(email.sizeBytes)}
        </p>
        {email.recipientAddress ? (
          <p className="mt-1 text-xs text-zinc-500">
            Delivered to <span className="font-medium text-zinc-300">{email.recipientAddress}</span>
          </p>
        ) : null}
      </div>

      {/* Attachments */}
      {email.attachments.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {email.attachments.map((attachment) => {
            const busy = downloadingId === attachment.id;
            return (
              <button
                key={attachment.id}
                type="button"
                className="flex items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2 text-left text-sm transition-colors hover:border-flame-500/30 hover:bg-zinc-800/70 disabled:opacity-50"
                onClick={() => handleDownload(attachment)}
                disabled={busy || loading}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-flame-400" />
                ) : (
                  <Download className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <span>
                  <strong className="block text-xs font-medium text-zinc-300">{attachment.filename || "attachment.bin"}</strong>
                  <span className="text-xs text-zinc-500">{formatSize(attachment.sizeBytes)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Body */}
      {email.html && preparedHtml ? (
        <div className="mt-4 flex flex-1 flex-col gap-3">
          <div className="flex h-8 items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-800/30 px-3">
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Shield className="h-3 w-3 text-zinc-500" />
              Sandboxed view
            </span>
            {preparedHtml.blockedRemoteContent && !allowRemoteContent ? (
              <button
                type="button"
                className="text-xs font-medium text-amber-200 transition-colors hover:text-amber-100"
                onClick={() => setAllowRemoteContent(true)}
              >
                Load remote content
              </button>
            ) : preparedHtml.blockedRemoteContent && allowRemoteContent ? (
              <span className="text-xs text-emerald-400">Remote content loaded</span>
            ) : null}
          </div>

          <iframe
            className="min-h-[520px] w-full flex-1 rounded-xl border border-zinc-800/60 bg-zinc-900"
            title={`Email ${email.id}`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={buildSrcDoc(preparedHtml.html, preparedHtml.bodyAttributes, preparedHtml.headHtml)}
          />
        </div>
      ) : (
        <div className="mt-4 flex-1">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <FileText className="h-3.5 w-3.5" />
            Plain text
          </div>
          <pre className="overflow-auto rounded-xl border border-zinc-800/60 bg-zinc-800/30 p-5 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {email.text || "This email has no text content."}
          </pre>
        </div>
      )}
    </section>
  );
}
