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
