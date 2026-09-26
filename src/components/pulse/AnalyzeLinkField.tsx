import { useState } from "react";
import { Button } from "@/components/ui/button";
import { importFromXUrl } from "@/lib/xpulse/api";

type AnalyzeState = {
  ok: boolean;
  message: string;
  scope?: "private" | "public";
};

export function AnalyzeLinkField({
  onImported,
  compact = false,
}: {
  onImported?: (id?: string) => void;
  compact?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalyzeState | null>(null);

  async function analyze() {
    const link = url.trim();

    if (!link) {
      setResult({
        ok: false,
        message: "Paste a link to an X post, thread, or article first.",
      });
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const response = await importFromXUrl({
        data: { url: link },
      });

      setResult({
        ok: response.ok,
        message: response.message,
        scope: "scope" in response ? response.scope : undefined,
      });

      if (response.ok) {
        setUrl("");
        onImported?.(typeof response.id === "string" ? response.id : undefined);
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Could not analyze that link.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        compact
          ? "panel p-3 backdrop-blur-md"
          : "panel p-5"
      }
    >
      {compact ? null : (
        <>
          <p className="text-xs tracking-[0.18em] text-accent">ANALYZE A POST</p>
          <h2 className="mt-1 text-xl font-medium tracking-tight">Paste a link from X.</h2>
          <p className="mt-1 text-sm text-muted">
            Drop in a post, thread, or article link and XPulse pulls the metrics.
          </p>
        </>
      )}

      <label className="sr-only" htmlFor="x-analyze-url">
        X post link
      </label>
      <div className={`flex flex-col gap-2 sm:flex-row ${compact ? "" : "mt-4"}`}>
        <input
          id="x-analyze-url"
          type="url"
          inputMode="url"
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void analyze();
          }}
          placeholder="https://x.com/username/status/…"
          aria-label="X post link"
          className="h-14 flex-1 rounded-sm border border-line bg-bg px-4 font-mono text-base text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        />

        <Button
          type="button"
          disabled={busy || !url.trim()}
          onClick={() => void analyze()}
          className="h-14 min-w-[9.5rem] px-6"
        >
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
      </div>

      {result ? (
        <p
          className={`mt-3 text-sm ${result.ok ? "text-accent" : "text-muted"}`}
          role="status"
          aria-live="polite"
        >
          {result.message}
          {result.ok && result.scope === "public"
            ? " Public X data — no X login or X API was used."
            : ""}
        </p>
      ) : compact ? (
        <p className="mt-2 text-xs text-subtle">Paste any X post, thread, or article URL.</p>
      ) : null}
    </div>
  );
}
