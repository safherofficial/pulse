/**
 * Public DEX paid-listing signal from the DexScreener orders feed.
 * DEX Paid is an approved tokenProfile or communityTakeover.
 * Boosts are a separate count and never flip DEX Paid.
 * Failure, timeout, or incomplete payloads stay UNKNOWN — never NOT PAID.
 */

export type DexOrderRow = {
  type?: string;
  status?: string;
};

export type DexBoostRow = {
  amount?: number;
};

export type DexPaidVerdict = {
  /** true = PAID, false = NOT PAID, null = UNKNOWN */
  dexPaid: boolean | null;
  /** null when the boost count was not actually returned */
  boostActive: number | null;
  orders: Array<{ type: string; status: string }>;
  detail: string;
  /** Mirrors dexPaid. Boosts do not count as a paid profile. */
  paidListing: boolean | null;
};

const PAID_TYPES = new Set(["tokenprofile", "communitytakeover"]);
const PENDING_STATUSES = new Set(["processing", "on-hold", "pending"]);
const CLOSED_STATUSES = new Set(["rejected", "cancelled", "canceled"]);

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normalizeOrder(row: DexOrderRow): { type: string; status: string } {
  return {
    type: String(row.type ?? "unknown").trim(),
    status: String(row.status ?? "unknown").trim().toLowerCase(),
  };
}

export function sumBoostAmounts(boosts: DexBoostRow[] | null): number | null {
  if (boosts == null) return null;
  if (boosts.length === 0) return 0;
  let sum = 0;
  let seen = false;
  for (const row of boosts) {
    const amount = finiteNumber(row.amount);
    if (amount == null) continue;
    seen = true;
    sum += amount;
  }
  return seen ? sum : null;
}

/**
 * Classify a parsed public orders payload.
 * `boosts === null` means the payload did not include a boost list (do not invent 0).
 */
export function classifyDexPaid(input: {
  ok: boolean;
  orders: DexOrderRow[] | null;
  boosts: DexBoostRow[] | null;
  pairBoosts: number | null;
  chainSupported: boolean;
}): DexPaidVerdict {
  const pairBoosts = finiteNumber(input.pairBoosts);
  const unknown = (detail: string, boostActive: number | null): DexPaidVerdict => ({
    dexPaid: null,
    boostActive,
    orders: [],
    detail,
    paidListing: null,
  });

  if (!input.chainSupported) {
    return unknown(
      "DEX Paid is unknown — this chain is not covered by the public orders feed.",
      pairBoosts,
    );
  }

  if (!input.ok || input.orders == null) {
    return unknown(
      "DEX Paid status unknown — public listing data is temporarily unavailable.",
      pairBoosts,
    );
  }

  const orders = input.orders.map(normalizeOrder);
  const approved = orders.some(
    (row) => PAID_TYPES.has(row.type.toLowerCase()) && row.status === "approved",
  );
  const pending = orders.some(
    (row) => PAID_TYPES.has(row.type.toLowerCase()) && PENDING_STATUSES.has(row.status),
  );
  const unrecognizedProfile = orders.some((row) => {
    if (!PAID_TYPES.has(row.type.toLowerCase())) return false;
    if (row.status === "approved") return false;
    if (PENDING_STATUSES.has(row.status) || CLOSED_STATUSES.has(row.status)) return false;
    return true;
  });

  const listedBoosts = sumBoostAmounts(input.boosts);
  const boostActive = input.boosts == null ? pairBoosts : listedBoosts;

  let dexPaid: boolean | null = false;
  let detail: string;
  if (approved) {
    dexPaid = true;
    detail = "PAID — an approved token profile or community takeover is on the public orders feed.";
  } else if (pending || unrecognizedProfile) {
    dexPaid = null;
    detail =
      "DEX Paid is unknown — a profile order exists but is not approved yet, or its status cannot be read.";
  } else if (orders.length > 0) {
    dexPaid = false;
    detail = "NOT PAID — public orders returned, and none is an approved token profile or community takeover.";
  } else {
    dexPaid = false;
    detail = "NOT PAID — the public orders feed returned no approved profile for this token.";
  }

  if (boostActive != null && boostActive > 0) {
    detail += ` Active boosts: ${boostActive}. Boosts are not DEX Paid.`;
  }

  return {
    dexPaid,
    boostActive,
    orders,
    detail,
    paidListing: dexPaid,
  };
}

/** Turn an HTTP result into a verdict. Non-JSON and non-2xx stay UNKNOWN. */
export function interpretDexOrdersHttp(input: {
  status: number;
  body: unknown;
  pairBoosts: number | null;
  chainSupported: boolean;
}): DexPaidVerdict {
  if (!input.chainSupported || input.status < 200 || input.status >= 300) {
    return classifyDexPaid({
      ok: false,
      orders: null,
      boosts: null,
      pairBoosts: input.pairBoosts,
      chainSupported: input.chainSupported,
    });
  }

  const body = input.body;
  if (Array.isArray(body)) {
    return classifyDexPaid({
      ok: true,
      orders: body as DexOrderRow[],
      boosts: null,
      pairBoosts: input.pairBoosts,
      chainSupported: true,
    });
  }

  if (!body || typeof body !== "object") {
    return classifyDexPaid({
      ok: false,
      orders: null,
      boosts: null,
      pairBoosts: input.pairBoosts,
      chainSupported: true,
    });
  }

  const record = body as { orders?: unknown; boosts?: unknown };
  if (!Array.isArray(record.orders)) {
    return classifyDexPaid({
      ok: false,
      orders: null,
      boosts: null,
      pairBoosts: input.pairBoosts,
      chainSupported: true,
    });
  }

  const boosts = Array.isArray(record.boosts) ? (record.boosts as DexBoostRow[]) : null;
  return classifyDexPaid({
    ok: true,
    orders: record.orders as DexOrderRow[],
    boosts,
    pairBoosts: input.pairBoosts,
    chainSupported: true,
  });
}
