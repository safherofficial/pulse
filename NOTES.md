# XPulse — Analyze-link field + 3D heatmap

Two new, self-contained files. Nothing existing was touched.

- `src/components/pulse/AnalyzeLinkField.tsx`
- `src/components/pulse/HeatmapScene.tsx`

## 1. Install the new dependency

Only `HeatmapScene.tsx` needs it:

```
npm install three @react-three/fiber @react-three/drei
```

(`@types/three` too, if your `three` install doesn't ship its own types.)

## 2. Add the missing server-fn wrapper

I don't have `src/lib/xpulse/api.ts`, so I couldn't diff it. Based on the
pattern your other calls already use (`loginWithWallet({ data })`,
`verifyPayment({ data })`, `getMe()`), add an export there that calls the
`runImportFromXUrl` function already added to `data.server.ts`:

```ts
export const importFromXUrl = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data, context }) => {
    return runImportFromXUrl(context.userId, data);
  });
```

Adjust `context.userId` to however your other authenticated handlers in
that file pull the current user — copy the exact pattern from
`verifyPayment` or `getMe` in that same file.

## 3. Mount the two components

Both are plain, typed React components — drop them wherever the Chamber
dashboard (`/pulse`) renders today:

```tsx
import { AnalyzeLinkField } from "@/components/pulse/AnalyzeLinkField";
import { HeatmapScene } from "@/components/pulse/HeatmapScene";

<AnalyzeLinkField onImported={() => void refreshOverview()} />
<HeatmapScene heatmap={overview.heatmap} label={overview.heatmapLabel} />
```

`heatmap` is the `number[7][24]` array (day × hour, 0–1) your
`runOverview` / `runSync` already return — no shape change needed.

## Design notes

- Both components reuse your existing utility classes only
  (`border-line`, `bg-surface`, `text-fg`, `text-muted`, `text-subtle`,
  `bg-bg`, plus your `Button`) — no new colors invented.
- `HeatmapScene` reads its actual colors at runtime from those same
  classes (via a hidden probe element), so it always matches the live
  theme instead of a hardcoded palette.
- Motion is restrained on purpose: a slow idle auto-rotate that stops
  the moment someone drags, and a small breathing pulse on only the
  single highest-activity cell (tying into "XPulse"). Everything
  respects `prefers-reduced-motion`.
- Day/hour labels are rendered as real DOM (`<Html>` from drei) using
  your `font-mono` class, not baked textures — so they stay crisp and
  on-theme at any zoom level.
