XPulse Chamber unlock / wallet first-click fix

Files:
- src/components/pay/WalletLogin.tsx  (complete replacement)
- src/routes/pulse.tsx                (complete replacement)
- PayClient.patch                     (targeted patch for src/components/pay/PayClient.tsx)

Behavior fixed:
1. Wallet selection is performed on pointerdown so the first user click can connect the selected wallet.
2. The old auto-connect effect is removed from PayClient; Phantom is no longer expected to connect from a non-user useEffect.
3. /pulse retries a locked entitlement response briefly before redirecting to /onboard, preventing a transient post-payment lock.
4. Server-side wallet-bound entitlement logic is unchanged.
