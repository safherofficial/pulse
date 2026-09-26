import {
  WalletAdapterNetwork,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { GlowWalletAdapter } from "@solana/wallet-adapter-glow";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChamberUnlockTransition } from "@/components/pay/ChamberUnlockTransition";
import { getBillingConfig, getMe, verifyPayment } from "@/lib/xpulse/api";
import { shortAddress } from "@/lib/xpulse/format";
import type { BillingConfig, Me } from "@/lib/xpulse/types";

const CLUSTER = "mainnet-beta" as const;
const ENDPOINT = clusterApiUrl(CLUSTER);
const NETWORK = WalletAdapterNetwork.Mainnet;
const VERIFY_ATTEMPTS = 6;
const VERIFY_RETRY_DELAY_MS = 1500;

type PayWalletAdapter = WalletAdapter;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableVerificationMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unexpected server error") ||
    normalized.includes("transaction not found yet") ||
    normalized.includes("could not read that transaction") ||
    normalized.includes("rpc")
  );
}

export function PayClient() {
  const wallets = useMemo<PayWalletAdapter[]>(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: NETWORK }),
      new BackpackWalletAdapter(),
      new GlowWalletAdapter({ network: NETWORK }),
    ],
    [],
  );

  return <PayPanel wallets={wallets} />;
}

function PayPanel({ wallets }: { wallets: PayWalletAdapter[] }) {
  const connection = useMemo(() => new Connection(ENDPOINT, "confirmed"), []);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lifetimeOverride, setLifetimeOverride] = useState<boolean | null>(null);
  const [activeAdapter, setActiveAdapter] = useState<PayWalletAdapter | null>(null);
  const [activePublicKey, setActivePublicKey] = useState<PublicKey | null>(null);
  const [enteringChamber, setEnteringChamber] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [verifyingSignature, setVerifyingSignature] = useState(false);

  async function refresh(showError = true) {
    try {
      const next = await getMe();
      setMe(next);
      if (next.wallet?.isLifetime) {
        setLifetimeOverride(true);
      }
      return next;
    } catch {
      if (showError) {
        setNote("Could not load your wallet access.");
      }
      return null;
    }
  }

  useEffect(() => {
    void getBillingConfig()
      .then(setConfig)
      .catch(() => setNote("Could not load payment settings."));
    void refresh();

    return () => {
      const adapter = activeAdapter;
      if (adapter?.connected) {
        void adapter.disconnect().catch(() => undefined);
      }
    };
    // The adapter is owned by this payment surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lifetime = lifetimeOverride ?? Boolean(me?.wallet?.isLifetime);
  const trialActive = me?.wallet?.plan === "trial" && Boolean(me.wallet.active);
  const trialExpired =
    me?.wallet?.plan === "trial" && !me.wallet.active && Boolean(me.wallet.trialStartedAt);
  const connected = Boolean(activeAdapter?.connected && activePublicKey);
  const mainnetBlocked = Boolean(config && !config.mainnetEnabled);

  useEffect(() => {
    if (!connected || !lifetime || enteringChamber) return;
    setEnteringChamber(true);
  }, [connected, lifetime, enteringChamber]);

  const finishChamberEntry = () => {
    window.location.assign("/pulse");
  };

  async function connectWallet(adapter: PayWalletAdapter) {
    if (busy) return;

    setBusy(true);
    setNote(null);

    try {
      if (activeAdapter && activeAdapter !== adapter && activeAdapter.connected) {
        await activeAdapter.disconnect();
      }

      if (!adapter.connected) {
        await adapter.connect();
      }

      const publicKey = adapter.publicKey;
      if (!publicKey) {
        throw new Error("Wallet connected without a public key.");
      }

      const sessionWallet = me?.wallet?.address ?? null;
      if (sessionWallet && sessionWallet !== publicKey.toBase58()) {
        await adapter.disconnect().catch(() => undefined);
        throw new Error(
          `Connect the wallet used to sign in: ${shortAddress(sessionWallet)}.`,
        );
      }

      setActiveAdapter(adapter);
      setActivePublicKey(publicKey);
      setNote(`Connected ${shortAddress(publicKey.toBase58())}.`);
    } catch (error) {
      setActiveAdapter(null);
      setActivePublicKey(null);
      setNote(error instanceof Error ? error.message : "Could not connect the wallet.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyConfirmedPayment(signature: string, address: string) {
    setVerifyingSignature(true);
    let lastMessage = "The payment was confirmed, but XPulse could not verify it yet.";

    try {
      for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
        try {
          const result = await verifyPayment({
            data: {
              address,
              signature,
              cluster: CLUSTER,
            },
          });

          setNote(result.message);

          if (result.ok && result.lifetime) {
            setPendingSignature(null);
            setLifetimeOverride(true);
            void refresh(false);
            return true;
          }

          lastMessage = result.message;
          if (!isRetryableVerificationMessage(result.message)) {
            return false;
          }
        } catch (error) {
          lastMessage = error instanceof Error ? error.message : "Unexpected server error.";
        }

        if (attempt < VERIFY_ATTEMPTS - 1) {
          await sleep(VERIFY_RETRY_DELAY_MS);
        }
      }
    } finally {
      setVerifyingSignature(false);
    }

    setNote(
      `Payment sent and confirmed. Verification is still pending. Do not pay again; verify the same transaction again below. (${lastMessage})`,
    );
    return false;
  }

  async function pay() {
    const adapter = activeAdapter;
    const publicKey = activePublicKey;
    const wallet = me?.wallet;

    if (!adapter || !publicKey || !config) {
      setNote("Connect your Solana wallet first.");
      return;
    }

    if (!wallet?.address || wallet.address !== publicKey.toBase58()) {
      setNote("Connect the wallet used to sign in to XPulse.");
      return;
    }

    if (trialActive) {
      setNote("Your 7-day Pro trial is active. Payment is available after the trial ends.");
      return;
    }

    if (mainnetBlocked) {
      setNote("Mainnet payment is not enabled yet. Configure SOLANA_TREASURY_ADDRESS in Vercel.");
      return;
    }

    setBusy(true);
    setNote(null);

    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const treasury = new PublicKey(config.treasury);

      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasury,
          lamports: config.priceLamports,
        }),
      );

      const signature = await adapter.sendTransaction(tx, connection);
      setPendingSignature(signature);
      setNote("Payment signed. Confirming the transaction on Solana…");

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      await verifyConfirmedPayment(signature, publicKey.toBase58());
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The wallet did not send the transfer.");
    } finally {
      setBusy(false);
    }
  }

  async function retryPendingVerification() {
    if (!pendingSignature || !activePublicKey || verifyingSignature) return;
    setNote("Verifying the existing payment…");
    await verifyConfirmedPayment(pendingSignature, activePublicKey.toBase58());
  }

  async function disconnect() {
    const adapter = activeAdapter;
    if (!adapter) return;

    setBusy(true);
    try {
      await adapter.disconnect();
    } catch {
      // Clear local state even if the provider rejects disconnect.
    } finally {
      setActiveAdapter(null);
      setActivePublicKey(null);
      setBusy(false);
    }
  }

  if (enteringChamber) {
    return <ChamberUnlockTransition onComplete={finishChamberEntry} />;
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="kicker">$10 lifetime · SOL or USDC · mainnet</p>
        <h2 className="mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
          Lifetime access belongs to the wallet that pays.
        </h2>
        <p className="mt-3 max-w-xl text-muted">
          Your Solana wallet is the identity. The same wallet owns the Chamber and the Lifetime entitlement.
        </p>
      </div>

      {lifetime ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-fg">Pro Lifetime is active for this wallet.</p>
          <Link
            to="/pulse"
            className={`${buttonVariants()} mt-4`}
          >
            Open your chamber
          </Link>
        </motion.div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Solana wallets">
            {wallets.map((adapter) => {
              const installed =
                adapter.readyState === WalletReadyState.Installed ||
                adapter.readyState === WalletReadyState.Loadable;
              const selected = activeAdapter?.name === adapter.name && connected;

              return (
                <Button
                  key={adapter.name}
                  type="button"
                  variant={selected ? "primary" : "quiet"}
                  disabled={busy}
                  onClick={() => void connectWallet(adapter)}
                >
                  {adapter.icon ? <img src={adapter.icon} alt="" className="h-5 w-5" /> : null}
                  {adapter.name}
                  {installed ? "" : " · install"}
                </Button>
              );
            })}
          </div>

          {connected && activePublicKey ? (
            <p className="font-mono text-sm text-fg">Connected {shortAddress(activePublicKey.toBase58())}</p>
          ) : (
            <p className="text-sm text-muted">Connect the same Solana wallet used to create your XPulse account.</p>
          )}

          {trialActive ? (
            <div className="panel p-4">
              <p className="text-sm text-fg">Your free 7-day Pro trial is active.</p>
              <p className="mt-2 text-sm text-muted">
                {me?.wallet?.trialDaysRemaining ?? 0} day{me?.wallet?.trialDaysRemaining === 1 ? "" : "s"} remaining. Full Chamber access is enabled.
              </p>
            </div>
          ) : trialExpired ? (
            <div className="panel p-4">
              <p className="text-sm text-fg">Your 7-day trial has ended.</p>
              <p className="mt-2 text-sm text-muted">Pay $10 in SOL (live quote) or 10 USDC from this wallet to unlock the Chamber permanently.</p>
            </div>
          ) : null}

          <Button
            disabled={!connected || busy || mainnetBlocked || trialActive}
            onClick={() => void pay()}
          >
            {busy
              ? "Working…"
              : config
                ? `Pay ~${config.priceSol.toFixed(4)} SOL ($${config.priceUsd})`
                : "Pay $10 lifetime"}
          </Button>

          {config ? (
            <p className="text-xs text-subtle">
              Live quote via {config.solUsdSource}: 1 SOL ≈ ${config.solUsd.toFixed(2)}. Or send exactly {config.priceUsdc} USDC
              (mint {config.usdcMint.slice(0, 4)}…{config.usdcMint.slice(-4)}) to the treasury and verify the signature.
            </p>
          ) : null}

          {pendingSignature ? (
            <div className="panel grid gap-2 p-4">
              <p className="text-sm text-muted">Transaction: {shortAddress(pendingSignature)}</p>
              <Button
                type="button"
                variant="quiet"
                disabled={verifyingSignature || busy}
                onClick={() => void retryPendingVerification()}
              >
                {verifyingSignature ? "Verifying…" : "Verify existing payment"}
              </Button>
            </div>
          ) : null}

          {mainnetBlocked ? (
            <p className="text-sm text-muted">Mainnet payment requires SOLANA_TREASURY_ADDRESS in Vercel.</p>
          ) : null}
        </>
      )}

      {connected ? (
        <button
          type="button"
          className="text-left text-sm text-muted underline"
          disabled={busy}
          onClick={() => void disconnect()}
        >
          Disconnect wallet
        </button>
      ) : null}

      {note ? (
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}
    </div>
  );
}

