import { AlertTriangle, ArrowUpRight, Copy, Shield } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "@/client/components/toast";
import { parseExternalLinkTarget } from "@/client/lib/external-link";

export function ExternalLinkRedirect() {
  const [searchParams] = useSearchParams();
  const [copied, setCopied] = useState(false);
  const target = useMemo(() => parseExternalLinkTarget(searchParams.get("url")), [searchParams]);

  const handleCopy = async () => {
    if (!target) {
      return;
    }

    try {
      await navigator.clipboard.writeText(target.toString());
      setCopied(true);
      toast.success("Link copied to clipboard.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy the link.");
    }
  };

  return (
    <main className="animate-slide-up mx-auto max-w-2xl pt-2">
      <section className="overflow-hidden rounded-3xl border border-zinc-800/60 bg-zinc-900/60 shadow-2xl shadow-black/20">
        <div className="border-b border-zinc-800/60 bg-zinc-950/80 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="inline-grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/20">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-zinc-100 sm:text-xl">Leaving flamemail</h1>
              <p className="mt-1 text-sm text-zinc-400">Links in emails open through this safety check first.</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
          {target ? (
            <>
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/60 p-4">
                <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Destination
                </span>
                <strong className="mt-3 block break-all text-sm font-semibold text-zinc-100 sm:text-base">
                  {target.host}
                </strong>
                <p className="mt-2 break-all font-mono text-xs leading-relaxed text-zinc-400 sm:text-sm">
                  {target.toString()}
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4 text-sm text-amber-100/90">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p>
                  Email links can be misleading. Check the destination carefully before continuing, especially if the
                  message asks for passwords, codes, or payments.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={target.toString()}
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-400"
                >
                  Continue to site
                  <ArrowUpRight className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700/70 bg-zinc-800/70 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied" : "Copy URL"}
                </button>
                <Link
                  to="/create"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  Back to inboxes
                </Link>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-100/90">
              This email link is missing a valid destination. Go back to the inbox and try again.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
