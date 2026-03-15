import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { getErrorMessage, getPublicConfig } from "@/client/lib/api";

interface TurnstileRenderOptions {
  action: string;
  appearance?: "always" | "execute" | "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  sitekey: string;
  size?: "normal" | "compact" | "flexible";
  theme?: "auto" | "light" | "dark";
}

interface TurnstileApi {
  remove(widgetId: string): void;
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript() {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
    );

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }

      turnstileScriptPromise = null;
      reject(new Error("Human verification is temporarily unavailable."));
    };

    const handleError = () => {
      turnstileScriptPromise = null;
      reject(new Error("Human verification is temporarily unavailable."));
    };

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

interface TurnstileWidgetProps {
  action: string;
  onError?: (error: string | null) => void;
  onTokenChange: (token: string | null) => void;
  resetKey: number;
}

export function TurnstileWidget({ action, onError, onTokenChange, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetKeyRef = useRef(resetKey);
  const [turnstile, setTurnstile] = useState<TurnstileApi | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      setLoadError(false);

      try {
        const [config, api] = await Promise.all([getPublicConfig(), loadTurnstileScript()]);
        if (!active) {
          return;
        }

        setSiteKey(config.turnstileSiteKey);
        setTurnstile(api);
      } catch (nextError) {
        if (!active) {
          return;
        }

        onTokenChange(null);
        const message = getErrorMessage(nextError);
        setError(message);
        setLoadError(true);
        onError?.(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [loadKey, onError, onTokenChange]);

  useEffect(() => {
    if (!containerRef.current || !turnstile || !siteKey || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme: "dark",
      size: "flexible",
      appearance: "interaction-only",
      callback: (token) => {
        setError(null);
        onError?.(null);
        onTokenChange(token);
      },
      "error-callback": () => {
        const message = "Human verification failed. Please try again.";
        onTokenChange(null);
        setError(message);
        onError?.(message);
      },
      "expired-callback": () => {
        const message = "Human verification expired. Please try again.";
        onTokenChange(null);
        setError(message);
        onError?.(message);
      },
    });

    // Cloudflare Turnstile can render its host on a fractional Y position
    // (for example, on 1.5 DPR displays), which causes the widget to lose its
    // bottom border by 1px. Snap the host upward by the fractional bottom
    // offset after render and on resize to keep the border visible.
    const alignWidgetHost = () => {
      const container = containerRef.current;
      const host = container?.firstElementChild;
      if (!container || !(host instanceof HTMLElement)) {
        return;
      }

      const bottom = container.getBoundingClientRect().bottom;
      const bottomFraction = bottom - Math.floor(bottom);
      host.style.transform = bottomFraction > 0.001 ? `translateY(${-bottomFraction}px)` : "";
    };

    const frameId = window.requestAnimationFrame(alignWidgetHost);
    window.addEventListener("resize", alignWidgetHost);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", alignWidgetHost);
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, onError, onTokenChange, siteKey, turnstile]);

  useEffect(() => {
    if (!turnstile || !widgetIdRef.current) {
      previousResetKeyRef.current = resetKey;
      return;
    }

    if (resetKey === previousResetKeyRef.current) {
      return;
    }

    previousResetKeyRef.current = resetKey;
    onTokenChange(null);
    setError(null);
    turnstile.reset(widgetIdRef.current);
  }, [onTokenChange, resetKey, turnstile]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading human verification...
        </p>
      ) : null}
      {error ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-400">{error}</p>
          {loadError ? (
            <button
              type="button"
              onClick={() => setLoadKey((value) => value + 1)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
