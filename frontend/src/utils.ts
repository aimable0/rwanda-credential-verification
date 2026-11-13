// Plain helpers used by App.tsx. They have no React or browser dependencies.

export type Tone = "ok" | "warn" | "bad";

export function outcomeMeta(result: string): {
  tone: Tone;
  title: string;
  text: string;
} {
  switch (result) {
    case "GENUINE_AND_ACTIVE":
      return {
        tone: "ok",
        title: "Genuine and active",
        text: "The details you entered match the record anchored on-chain.",
      };
    case "GENUINE_BUT_REVOKED":
      return {
        tone: "warn",
        title: "Genuine but revoked",
        text: "The details match, but the issuing institution has revoked this credential.",
      };
    default:
      return {
        tone: "bad",
        title: "Mismatch or not found",
        text: "No on-chain record matches these details. Check each field against the certificate.",
      };
  }
}

export function sentence(s: string) {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function shortAddr(a: string, head = 6, tail = 4) {
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

export function sameAddress(a?: string | null, b?: string | null) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Stored reference codes look like "UNIVA-220001624". Show only the certificate number.
export function certNumberOf(referenceCode: string, institutionCode: string) {
  const prefix = `${institutionCode}-`;
  return referenceCode.startsWith(prefix)
    ? referenceCode.slice(prefix.length)
    : referenceCode;
}

/** Plain-language message for an error thrown while issuing through MetaMask. */
export function txErrorMessage(err: any): string {
  switch (err?.code) {
    case "ACTION_REJECTED":
      return "You rejected the transaction in MetaMask. Nothing was issued. Click the button to try again.";
    case "INSUFFICIENT_FUNDS":
      return "Your account has no Sepolia ETH to pay the network fee. Get some from a Sepolia faucet, then try again.";
    case "CALL_EXCEPTION":
      return "The blockchain rejected this transaction. This certificate number may already be issued. Check the list below, or try a different number.";
    default:
      return err?.shortMessage ?? err?.message ?? "Issuance failed";
  }
}
