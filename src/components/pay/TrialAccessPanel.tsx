import {
  useEffect,
  useState,
} from "react";

import { Link } from "@tanstack/react-router";

import { Button, buttonVariants } from "@/components/ui/button";

import {
  getMe,
  startTrial,
} from "@/lib/xpulse/api";

import {
  shortAddress,
} from "@/lib/xpulse/format";

import type {
  Me,
} from "@/lib/xpulse/types";

export function TrialAccessPanel() {
  const [
    me,
    setMe,
  ] =
    useState<Me | null>(
      null,
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    note,
    setNote,
  ] =
    useState<string | null>(
      null,
    );

  async function refresh() {
    try {
      const next =
        await getMe();

      setMe(next);
    } catch {
      setNote(
        "Could not load wallet access.",
      );
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function activate() {
    setBusy(true);
    setNote(null);

    try {
      const result =
        await startTrial();

      setNote(
        result.message,
      );

      if (
        result.ok
      ) {
        await refresh();
      }
    } catch (
      error
    ) {
      setNote(
        error instanceof Error
          ? error.message
          : "Could not start the trial.",
      );
    } finally {
      setBusy(false);
    }
  }

  const wallet =
    me?.wallet;

  const lifetime =
    Boolean(
      wallet?.isLifetime,
    );

  const trialActive =
    wallet?.plan ===
      "trial" &&
    wallet.active;

  const trialUsed =
    wallet?.plan ===
      "trial" &&
    !wallet.active &&
    Boolean(
      wallet.trialStartedAt,
    );

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Wallet access</p>

          <h2 className="mt-1 text-xl font-medium">
            Your Pro Chamber
          </h2>
        </div>

        {wallet ? (
          <span className="font-mono text-xs text-muted">
            {shortAddress(
              wallet.address,
            )}
          </span>
        ) : null}
      </div>

      {!wallet ? (
        <p className="mt-4 text-sm text-muted">
          No wallet entitlement is attached
          to this session.
        </p>
      ) : lifetime ? (
        <>
          <p className="mt-4 text-sm text-fg">
            Pro Lifetime is active.
          </p>

          <p className="mt-2 text-xs text-muted">
            This Chamber belongs permanently
            to this wallet.
          </p>

          <Link
            to="/pulse"
            className={`${buttonVariants()} mt-4`}
          >
            Open your chamber
          </Link>
        </>
      ) : trialActive ? (
        <>
          <p className="mt-4 text-sm text-fg">
            Pro Trial is active.
          </p>

          <p className="mt-2 text-xs text-muted">
            Full Pro functionality ·{" "}
            {
              wallet.trialDaysRemaining
            }{" "}
            day
            {wallet.trialDaysRemaining ===
            1
              ? ""
              : "s"}{" "}
            remaining.
          </p>

          <Link
            to="/pulse"
            className={`${buttonVariants()} mt-4`}
          >
            Open your chamber
          </Link>
        </>
      ) : trialUsed ? (
        <>
          <p className="mt-4 text-sm text-fg">
            The 7-day trial has ended.
          </p>

          <p className="mt-2 text-xs text-muted">
            This wallet can still unlock the
            Chamber permanently with Pro Lifetime.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-fg">
            7-day Pro trial
          </p>

          <p className="mt-2 text-sm text-muted">
            Full Chamber functionality for 7
            days. The trial is permanently
            attached to this wallet and can only
            be used once.
          </p>

          <Button
            type="button"
            className="mt-4"
            disabled={
              busy
            }
            onClick={() =>
              void activate()
            }
          >
            {busy
              ? "Activating…"
              : "Start 7-day Pro trial"}
          </Button>
        </>
      )}

      {note ? (
        <p
          className="mt-3 text-sm text-fg"
          role="status"
          aria-live="polite"
        >
          {note}
        </p>
      ) : null}
    </section>
  );
}
