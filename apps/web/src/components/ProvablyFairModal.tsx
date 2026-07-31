import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { apiRequest } from "../lib/api";
import type { RoundProof } from "../types";

type Props = {
  roundId: string;
  onClose: () => void;
};

export function ProvablyFairModal({ roundId, onClose }: Props) {
  const [proof, setProof] = useState<RoundProof | null>(null);
  const [error, setError] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProof(null);
    setError("");

    void apiRequest<{ proof: RoundProof }>(`/api/rounds/${encodeURIComponent(roundId)}/proof`)
      .then((result) => {
        if (!cancelled) setProof(result.proof);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Unable to load round proof.");
      });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [roundId]);

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => current === label ? "" : current), 1400);
    } catch {
      setCopied("");
    }
  };

  const displayRound = proof?.roundId ?? roundId;
  const displayTime = proof
    ? new Date(proof.crashedAt).toLocaleString(undefined, { hour12: false })
    : "Loading…";

  return (
    <div className="modal-backdrop proof-backdrop" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.target === event.currentTarget && onClose()}>
      <section className="proof-modal" role="dialog" aria-modal="true" aria-label="Provably fair round details">
        <header className="proof-header">
          <div>
            <strong>ROUND {displayRound}</strong>
            {proof && <span className={proof.result < 2 ? "blue" : proof.result < 10 ? "purple" : "pink"}>{proof.result.toFixed(2)}x</span>}
            <time>{displayTime}</time>
          </div>
          <button type="button" aria-label="Close proof details" onClick={onClose}>×</button>
        </header>

        {error && <div className="proof-state error">{error}</div>}
        {!proof && !error && <div className="proof-state">Loading verified round data…</div>}

        {proof && (
          <div className="proof-content">
            <ProofSection icon="▤" title="Server Seed" subtitle="Generated on the server and revealed after the round">
              <CopyValue label="Server seed" value={proof.serverSeed} copied={copied} onCopy={copyValue} />
            </ProofSection>

            <ProofSection icon="▱" title="Client Seed" subtitle="The round ID used as the public HMAC input">
              <CopyValue label="Client seed" value={proof.clientSeed} copied={copied} onCopy={copyValue} />
            </ProofSection>

            <ProofSection icon="⌁" title="Server Seed Commitment" subtitle="SHA-256 commitment published before the result">
              <CopyValue label="Commitment" value={proof.commit} copied={copied} onCopy={copyValue} />
            </ProofSection>

            <ProofSection icon="♢" title="Combined HMAC-SHA256 Hash" subtitle="Server seed and client seed combined by the game algorithm">
              <CopyValue label="Combined hash" value={proof.combinedHash} copied={copied} onCopy={copyValue} />
              <div className="proof-result-grid">
                <div><span>Hex</span><strong>{proof.resultHex}</strong></div>
                <div><span>Decimal</span><strong>{proof.resultDecimal}</strong></div>
                <div><span>Result</span><strong>{proof.result.toFixed(2)}x</strong></div>
              </div>
            </ProofSection>

            {proof.liquidityLimited && (
              <div className="proof-note">The deterministic seed result was {proof.naturalResult.toFixed(2)}x. The recorded round used the platform liquidity safety cap.</div>
            )}

            <div className={`proof-verification ${proof.verificationStatus.toLowerCase()}`}>
              <span>{proof.verificationStatus === "VERIFIED" ? "✓" : proof.verificationStatus === "PARTIAL" ? "i" : "!"}</span>
              <div>
                <strong>{proof.verificationStatus === "VERIFIED" ? "Round proof verified" : proof.verificationStatus === "PARTIAL" ? "Commit verified — legacy round" : "Round proof mismatch"}</strong>
                <small>{proof.verificationStatus === "PARTIAL" ? "This older round does not contain every rule snapshot required for complete result verification." : "Commitment and result were recalculated from the revealed seed."}</small>
              </div>
            </div>
          </div>
        )}

        <footer className="proof-footer">
          <span>For instructions check</span>
          <button type="button" onClick={() => setInstructionsOpen((value) => !value)}>What is Provably Fair</button>
        </footer>
        {instructionsOpen && (
          <div className="proof-instructions">
            Hash the revealed server seed with SHA-256 and compare it with the commitment. Then calculate HMAC-SHA256 using the server seed as the key and the round ID as the message. The first 13 hexadecimal characters are converted to a number, passed through the house-edge formula, and limited by the configured maximum multiplier to reproduce the round result.
          </div>
        )}
      </section>
    </div>
  );
}

type ProofSectionProps = {
  icon: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

function ProofSection({ icon, title, subtitle, children }: ProofSectionProps) {
  return (
    <section className="proof-section">
      <div className="proof-section-heading">
        <i aria-hidden="true">{icon}</i>
        <div><strong>{title}</strong><span>{subtitle}</span></div>
      </div>
      {children}
    </section>
  );
}

type CopyValueProps = {
  label: string;
  value: string;
  copied: string;
  onCopy: (label: string, value: string) => void;
};

function CopyValue({ label, value, copied, onCopy }: CopyValueProps) {
  return (
    <button className="proof-value" type="button" title={`Copy ${label.toLowerCase()}`} onClick={() => void onCopy(label, value)}>
      <span>{value}</span>
      <small>{copied === label ? "Copied" : "Copy"}</small>
    </button>
  );
}
