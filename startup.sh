#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
# Preview-only: a confirmed devnet transfer can unlock lifetime. Production
# ignores this unless the same variable is set in the host environment.
export SOLANA_ALLOW_DEVNET_LIFETIME=true
npm run dev >>/tmp/app-startup.log 2>&1 &
