/**
 * External identity-gate authentication is permanently disabled.
 *
 * These compatibility exports intentionally return no identity. XPulse has
 * exactly one authentication mechanism: Solana wallet signature.
 */
export const GATE_IDENTITY_HEADER = "x-grok-identity";
export const GATE_JWKS_PATH = "/__gate/identity-key";
export const PREVIEW_GATE_ORIGIN = "";

export type GateIdentity = {
  sub: string;
  email: string | null;
  name: string | null;
  teamId: string | null;
};

export type GateJwks = { keys: unknown[] };
export type JwksFetch = (url: string) => Promise<GateJwks | null>;

export function gateIdentityEnabled(): boolean {
  return false;
}

export function gateTokenAudience(): string {
  return "disabled";
}

export function gateKeyResolver() {
  return async () => {
    throw new Error("External identity gate is disabled.");
  };
}

export type VerifyGateIdentityTokenOptions = {
  issuer: string;
  audience: string;
  getKey: unknown;
};

export async function verifyGateIdentityToken(): Promise<GateIdentity | null> {
  return null;
}

export function resolveGateEndpoints(): null {
  return null;
}

export type GateLinkedAccount = { providerId: string; accountId: string };

export function sessionBoundToGateIdentity(): boolean {
  return false;
}

export async function gateIdentityFromHeaders(): Promise<GateIdentity | null> {
  return null;
}

export type GateUserInfo = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

export function gateIdentityUserInfo(identity: GateIdentity): GateUserInfo {
  return {
    id: identity.sub,
    email: identity.email ?? "disabled@wallet.xpulse.invalid",
    emailVerified: false,
    name: identity.name ?? "Wallet",
  };
}
