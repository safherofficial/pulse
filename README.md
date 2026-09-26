# XPulse

Analytics chamber for people who publish on X. It treats detail expands, dwell, and profile visits as the readings that matter, and it sets a launch thread next to the X Article it was meant to open.

Access is a single Solana payment of **0.15 SOL**. No subscription. The wallet that pays is whitelisted for life, including across later X sessions.
## What you can do

- Walk the sample chamber before paying: pick one link and the 3D graph reads only that post, then compare it with a viral example.
- Sign in with a Solana wallet. The wallet signs a short login challenge and the resulting session stays bound to that wallet account.
- Connect Phantom, Solflare, Backpack, or Glow.
- Pay 0.15 SOL. The server reads the transaction from Solana RPC and checks that the treasury balance rose by at least 0.15 SOL and that your wallet signed and spent it.
- After unlock: import posts, sync from the X API when credentials exist, and link one thread to one article.
## How the app is put together

The running app is one TanStack Start service (interface + server functions + Postgres). That is the deployable shape of this workspace. The pieces map to the modules you would split in a larger monorepo:

| Area | Path |
| --- | --- |
| Interface | `src/routes`, `src/components` |
| 3D chamber | `src/components/scene` |
| Analytics, payments, X client | `src/lib/xpulse` |
| Database | `migrations/` |
Auth is Better Auth for session management, while the public login flow is wallet-only. Per-user rows are scoped to the verified wallet-backed session. Postgres is Neon when `DATABASE_URL` is set, and an embedded Postgres otherwise.
## Metrics

Engagement rate:

`(likes + replies + reposts + bookmarks + profile clicks + link clicks) / impressions`

Detail expands and dwell are stored when you import them, or when the X API actually returns them (`non_public_metrics` / `organic_metrics`). Missing fields stay empty rather than being invented. The account heatmap is inferred from publish time weighted by opens. The sample heatmap is a fixed follower-activity rehearsal and is labeled as such.
## Solana

| Variable | Meaning |
| --- | --- |
| `SOLANA_TREASURY_ADDRESS` | Wallet that should receive 0.15 SOL. **Required for mainnet.** Without it, mainnet payments are refused. |
| `SOLANA_MAINNET_RPC` / `SOLANA_DEVNET_RPC` | Optional RPC URLs. Defaults are the public Solana endpoints. |
| `SOLANA_ALLOW_DEVNET_LIFETIME` | `true` lets a confirmed devnet transfer grant lifetime. Leave unset in production. |
The built-in devnet address is a sink for rehearsal. Do not send mainnet SOL anywhere until `SOLANA_TREASURY_ADDRESS` is a wallet you control.

Verification uses `getTransaction` (confirmed, max supported version 0) and balance deltas, so both legacy and versioned transfers count. A signature can unlock only one wallet.
## X API

Wallet authentication identifies you. Reading posts needs a separate OAuth 2.0 PKCE connection to the X API (scopes `tweet.read users.read offline.access`). This X connection is an API integration, not an application login method.

| Variable | Meaning |
| --- | --- |
| `X_CLIENT_ID` | X app client id |
| `X_CLIENT_SECRET` | X app client secret |
| `X_REDIRECT_URI` | Optional. Defaults to `{origin}/api/x/callback` |

Until those are set, sync explains that and you can import a post by URL or id. Rate limits from X (HTTP 429) stop the sync and say so. Tokens stay on the server.
## Local setup

```bash
npm install
npm run dev
```
Schema lives in `migrations/0001_auth.sql` and `migrations/0002_xpulse.sql`. It applies on startup.

```bash
npm run typecheck
npm run build
node --experimental-strip-types --test src/lib/xpulse/*.test.ts
```

Do not commit a `.env`. The host injects `DATABASE_URL` and auth credentials. Client-visible values must be prefixed with `VITE_`. None of the secrets above are.
## API

Server functions, all session-scoped except billing config:
| Function | Role |
| --- | --- |
| `getBillingConfig` | Price, treasury, which clusters unlock |
| `getMe` | Profile, X link flag, wallet |
| `issueNonce` / `connectWallet` | Prove wallet ownership and attach it |
| `verifyPayment` | Confirm 0.15 SOL on-chain and grant lifetime |
| `getOverview` / `getHeatmap` / `getPost` | Readings |
| `importPost` | Manual post |
| `linkThread` | Article ↔ launch thread |
| `syncPosts` / `beginXConnect` | X API |
HTTP: `GET/POST /api/auth/*` for wallet-backed session handling, `GET /api/x/callback` for the X API code exchange.
