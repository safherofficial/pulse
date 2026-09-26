/**
 * External identity-gate authentication is permanently disabled in XPulse.
 *
 * The export is retained only for backwards-compatible imports from older
 * builds. It never creates, refreshes, or materializes a session.
 */
export const GATE_PROVIDER_ID = "disabled";

export function gateIdentitySessions() {
  return {
    id: "grok-gate-identity-disabled",
  };
}
