import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const getBillingConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { billingConfigLive } = await import("./data.server");
  return billingConfigLive();
});

export const issueLoginNonce = createServerFn({ method: "POST" }).handler(async () => {
  const { runIssueLoginNonce } = await import("./data.server");
  return runIssueLoginNonce();
});

export const loginWithWallet = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { runLoginWithWallet } = await import("./data.server");
    return runLoginWithWallet(data);
  });

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runMe } = await import("./data.server");
    return runMe(context.userId);
  });

export const issueNonce = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runIssueNonce } = await import("./data.server");
    return runIssueNonce(context.userId);
  });

export const connectWallet = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runConnectWallet } = await import("./data.server");
    return runConnectWallet(context.userId, data);
  });

export const startTrial = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runStartTrial } = await import("./data.server");
    return runStartTrial(context.userId);
  });

export const verifyPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runVerifyPayment } = await import("./data.server");
    return runVerifyPayment(context.userId, data);
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runOverview } = await import("./data.server");
    return runOverview(context.userId);
  });

export const getHeatmap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runHeatmap } = await import("./data.server");
    return runHeatmap(context.userId);
  });

export const getPost = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runPost } = await import("./data.server");
    return runPost(context.userId, data);
  });

export const importPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runImport } = await import("./data.server");
    return runImport(context.userId, data);
  });

export const linkThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runLink } = await import("./data.server");
    return runLink(context.userId, data);
  });

export const syncPosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runSync } = await import("./data.server");
    return runSync(context.userId);
  });

export const beginXConnect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runBeginX } = await import("./data.server");
    return runBeginX(context.userId);
  });

export const compareXUrls = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { runCompareXUrls } = await import("./data.server");
    return runCompareXUrls(data);
  });

export const importFromXUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const { runImportFromXUrl } = await import("./data.server");
    return runImportFromXUrl(context.userId, data);
  });

export const enrichAnalysis = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { enrichPostAnalysis } = await import("./enrich");
    const payload = data as {
      text?: string;
      xPostId?: string | null;
      metrics?: {
        impressions?: number;
        likes?: number;
        replies?: number;
        reposts?: number;
        bookmarks?: number;
        profileClicks?: number;
        linkClicks?: number;
        detailExpands?: number | null;
        dwellMs?: number | null;
        quotes?: number;
      };
    };
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) throw new Error("Text is required for enrichment.");
    return enrichPostAnalysis({
      text,
      xPostId: payload.xPostId ?? null,
      metrics: payload.metrics
        ? {
            impressions: Number(payload.metrics.impressions) || 0,
            likes: Number(payload.metrics.likes) || 0,
            replies: Number(payload.metrics.replies) || 0,
            reposts: Number(payload.metrics.reposts) || 0,
            bookmarks: Number(payload.metrics.bookmarks) || 0,
            profileClicks: Number(payload.metrics.profileClicks) || 0,
            linkClicks: Number(payload.metrics.linkClicks) || 0,
            detailExpands: payload.metrics.detailExpands ?? null,
            dwellMs: payload.metrics.dwellMs ?? null,
            quotes: payload.metrics.quotes ?? 0,
          }
        : undefined,
    });
  });

export const rewriteEnriched = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { enrichAndRewrite } = await import("./enrich");
    const text = typeof (data as { text?: string })?.text === "string" ? (data as { text: string }).text : "";
    if (!text.trim()) throw new Error("Text is required for rewrite.");
    const variant = Number((data as { variant?: number })?.variant ?? 0) || 0;
    return enrichAndRewrite(text, variant);
  });

export const deletePosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => data)
  .handler(async ({ data, context }) => {
    const { runDeletePosts } = await import("./data.server");
    return runDeletePosts(context.userId, data);
  });

export const clearPosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { runClearPosts } = await import("./data.server");
    return runClearPosts(context.userId);
  });

export const researchTokenIntel = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { address: string })
  .handler(async ({ data }) => {
    const { researchTokenByAddress } = await import("./token-intel");
    return researchTokenByAddress(data.address);
  });

export const writeTokenContent = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { writeTokenCopy } = await import("./content-llm");
    const payload = data as {
      facts?: import("./content-create").TokenFactSet;
      kind?: import("./content-score").ContentKind;
      mode?: import("./content-create").RegenMode;
      variant?: number;
    };
    if (!payload?.facts?.identity?.address) {
      throw new Error("Token fact set is required.");
    }
    const kind = payload.kind === "thread" || payload.kind === "article" ? payload.kind : "post";
    const mode = payload.mode ?? "default";
    const variant = Number(payload.variant ?? 0) || 0;
    return writeTokenCopy(payload.facts, kind, mode, variant);
  });

export const improveLoop = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { executeImproveLoop } = await import("./editor/server");
    const payload = data as {
      text?: string;
      url?: string;
      kind?: import("./content-score").ContentKind;
      target?: number;
    };
    if (!(payload?.text?.trim() || payload?.url?.trim())) {
      throw new Error("Text or URL is required.");
    }
    return executeImproveLoop({
      text: payload.text ?? "",
      url: payload.url ?? "",
      kind: payload.kind ?? "post",
      request: "Automatically improve this content using analyze → suggest → revise → analyze.",
    }, {}, Math.max(1, Math.min(100, Number(payload.target ?? 80) || 80)));
  });

export const reviseEditor = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { executeEditor } = await import("./editor/server");
    const { reviseWithLlm } = await import("./editor-llm");
    const payload = data as {
      dossier?: import("./editor/pipeline").EditorDossier;
      selected?: import("./editor-llm").AiSuggestion[];
    };
    if (!payload?.dossier || !Array.isArray(payload.selected) || !payload.selected.length) {
      throw new Error("A dossier and at least one selected intervention are required.");
    }
    const revision = await reviseWithLlm(payload.dossier, payload.selected);
    if (!revision?.text?.trim()) {
      throw new Error("The AI revision was unavailable or failed validation.");
    }
    const result = await executeEditor({
      text: payload.dossier.input.text,
      mode: "REWRITE",
      kind: payload.dossier.output.kind,
      request: "Apply only the selected editorial interventions.",
    }, {
      rewrite: async () => ({ text: revision.text, source: revision.trace.provider }),
    });
    return {
      ...result,
      output: {
        ...result.output,
        notes: [
          ...result.output.notes,
          `AI revision: ${revision.trace.provider} / ${revision.trace.model} / ${revision.trace.durationMs}ms`,
        ],
      },
      aiRevision: revision,
    };
  });

export const optimizationStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getOptimizationSummary } = await import("./optimize/store");
  return getOptimizationSummary();
});

export const improveDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { improveDraftCopy } = await import("./content-improve");
    const payload = data as { text?: string; kind?: import("./content-score").ContentKind };
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) throw new Error("Draft text is required.");
    const kind = payload.kind === "thread" || payload.kind === "article" ? payload.kind : "post";
    return improveDraftCopy(text, kind);
  });

export const threadifyDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { threadifyDraftCopy } = await import("./content-improve");
    const text = typeof (data as { text?: string })?.text === "string" ? (data as { text: string }).text : "";
    if (!text.trim()) throw new Error("Draft text is required.");
    return threadifyDraftCopy(text);
  });

export const strongerHookDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { strongerHookCopy } = await import("./content-improve");
    const payload = data as { text?: string; kind?: import("./content-score").ContentKind };
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) throw new Error("Draft text is required.");
    const kind = payload.kind === "thread" || payload.kind === "article" ? payload.kind : "post";
    return strongerHookCopy(text, kind);
  });

export const runEditor = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { executeEditor } = await import("./editor/server");
    const payload = data as { text?: string; url?: string; mode?: unknown; kind?: string; request?: string };
    const kind = payload?.kind === "thread" || payload?.kind === "article" || payload?.kind === "post" ? payload.kind : null;
    return executeEditor({
      text: typeof payload?.text === "string" ? payload.text : "",
      url: typeof payload?.url === "string" ? payload.url : "",
      mode: payload?.mode,
      kind,
      request: typeof payload?.request === "string" ? payload.request : "",
    });
  });
