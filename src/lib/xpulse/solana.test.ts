import assert from "node:assert/strict";
import { test } from "node:test";
import { assessTransfer, fromRpcResult } from "./solana.ts";

const payer = "PAYER";
const treasury = "TREASURY";

test("accepts a 0.15 SOL transfer signed by the payer", () => {
  const verdict = assessTransfer(
    {
      err: null,
      accounts: [
        { pubkey: payer, signer: true },
        { pubkey: treasury, signer: false },
      ],
      preBalances: [1_000_000_000, 0],
      postBalances: [849_995_000, 150_000_000],
    },
    { treasury, payer, minLamports: 150_000_000 },
  );
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.lamports, 150_000_000);
});

test("rejects a short payment and a failed transaction", () => {
  const short = assessTransfer(
    {
      err: null,
      accounts: [
        { pubkey: payer, signer: true },
        { pubkey: treasury, signer: false },
      ],
      preBalances: [1_000_000_000, 0],
      postBalances: [999_000_000, 1_000],
    },
    { treasury, payer, minLamports: 150_000_000 },
  );
  assert.equal(short.ok, false);
  const failed = assessTransfer(
    {
      err: { InstructionError: [0, "Custom"] },
      accounts: [
        { pubkey: payer, signer: true },
        { pubkey: treasury, signer: false },
      ],
      preBalances: [1, 0],
      postBalances: [0, 150_000_000],
    },
    { treasury, payer, minLamports: 150_000_000 },
  );
  assert.equal(failed.ok, false);
});

test("reads jsonParsed account keys and loaded addresses", () => {
  const tx = fromRpcResult({
    meta: {
      err: null,
      preBalances: [5, 1, 0],
      postBalances: [4, 1, 0],
      loadedAddresses: { writable: ["LOADED"], readonly: [] },
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: payer, signer: true },
          { pubkey: "OTHER", signer: false },
        ],
      },
    },
  });
  assert.ok(tx);
  assert.deepEqual(
    tx?.accounts.map((a) => a.pubkey),
    [payer, "OTHER", "LOADED"],
  );
});
