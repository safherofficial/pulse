import {
  WalletAdapterNetwork,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { GlowWalletAdapter } from "@solana/wallet-adapter-glow";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { issueLoginNonce, loginWithWallet } from "@/lib/xpulse/api";
import { shortAddress } from "@/lib/xpulse/format";

type LoginWallet = WalletAdapter & {
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

function u8ToB64(bytes: Uint8Array) {
  let raw = "";
  bytes.forEach((value) => {
    raw += String.fromCharCode(value);
  });
  return btoa(raw);
}

export function WalletLogin() {
  const wallets = useMemo<LoginWallet[]>(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet }),
      new BackpackWalletAdapter(),
      new GlowWalletAdapter({ network: WalletAdapterNetwork.Mainnet }),
    ],
    [],
  );

  return <LoginPanel wallets={wallets} />;
}

function LoginPanel({ wallets }: { wallets: LoginWallet[] }) {
  const [active, setActive] = useState<LoginWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      const adapter = active;
      if (adapter?.connected) {
        void adapter.disconnect().catch(() => undefined);
      }
    };
    // The adapter is intentionally owned by this login surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectWallet(adapter: LoginWallet) {
    if (busy) return;

    setBusy(true);
    setNote(null);

    try {
      if (active && active !== adapter && active.connected) {
        await active.disconnect();
      }

      if (!adapter.connected) {
        await adapter.connect();
      }

      const publicKey = adapter.publicKey;
      if (!publicKey) {
        throw new Error("Wallet connected without a public key.");
      }

      setActive(adapter);
      setAddress(publicKey.toBase58());
      setNote(`Connected ${shortAddress(publicKey.toBase58())}. Sign once to create your XPulse account.`);
    } catch (error) {
      setActive(null);
      setAddress(null);
      setNote(error instanceof Error ? error.message : "Could not connect the wallet.");
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    const adapter = active;
    const publicKey = adapter?.publicKey;
    if (!adapter || !publicKey || !adapter.signMessage) {
      setNote("Connect a Solana wallet first.");
      return;
    }

    setBusy(true);
    setNote(null);

    try {
      const nonce = await issueLoginNonce();
      if (!nonce.ok) {
        setNote(nonce.message);
        return;
      }

      const signature = await adapter.signMessage(
        new TextEncoder().encode(nonce.message),
      );

      const result = await loginWithWallet({
        data: {
          address: publicKey.toBase58(),
          message: nonce.message,
          signature: u8ToB64(signature),
        },
      });

      if (!result.ok) {
        setNote(result.message);
        return;
      }

      window.location.assign("/onboard");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not create your XPulse account.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectWallet() {
    const adapter = active;
    if (!adapter) return;

    setBusy(true);
    try {
      await adapter.disconnect();
    } catch {
      // Local state is cleared even when the provider rejects disconnect.
    } finally {
      setActive(null);
      setAddress(null);
      setBusy(false);
      setNote("Wallet disconnected.");
    }
  }

  return (
    <div className="grid max-w-md gap-4">
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Solana wallets">
        {wallets.map((adapter) => {
          const installed =
            adapter.readyState === WalletReadyState.Installed ||
            adapter.readyState === WalletReadyState.Loadable;
          const selected = active?.name === adapter.name && Boolean(address);

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

      {address ? (
        <p className="font-mono text-sm text-muted">Connected {shortAddress(address)}</p>
      ) : (
        <p className="text-sm text-muted">Choose Phantom, Solflare, Backpack, or Glow.</p>
      )}

      <Button
        type="button"
        disabled={!address || busy}
        onClick={() => void createAccount()}
      >
        {busy ? "Signing…" : "Create account with wallet"}
      </Button>

      {address ? (
        <button
          type="button"
          className="text-left text-sm text-muted underline"
          disabled={busy}
          onClick={() => void disconnectWallet()}
        >
          Disconnect
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
