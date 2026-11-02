import type { CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { formatNear } from "@aftercall/core";
import { explorerTx, type ProofOnChain } from "./near";
import { openLink } from "./SetupAssistant";
import { Button, cx } from "./ui";

/** "8hSHpr…XcD4M": enough of a hash to recognise it; the whole of it is in the link. */
const short = (hash: string) => (hash.length > 16 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash);

const at = (ms: number, name = "ac-in", length = 320): CSSProperties => ({ animation: `${name} ${length}ms ${ms}ms var(--ease) both` });

/**
 * "Your first NEAR transaction": shown once per Mac, for the meeting whose proof was this
 * Mac's first on NEAR, on the processing page and in Verify. Calm: it rises in after the
 * seal, and a row of blocks fills to the one this proof went into. With reduced motion,
 * everything only fades (styles.css redefines the keyframes).
 */
export function FirstTransaction({ onChain, delay = 0, className }: { onChain: ProofOnChain; delay?: number; className?: string }) {
  const fee = onChain.fee ? formatNear(BigInt(onChain.fee)) : null;
  const testnet = onChain.network === "testnet";
  return (
    <section
      aria-labelledby="first-tx"
      className={cx("flex flex-col gap-3.5 rounded-md bg-elevated px-5 pt-4.5 pb-4 shadow-1", className)}
      style={at(delay)}
    >
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="t-eyebrow text-verdigris">A first, on this Mac</span>
          <h2 id="first-tx" className="m-0 font-serif text-[22px] leading-7 font-medium tracking-[-0.01em] text-ink">
            Your first NEAR transaction
          </h2>
        </div>
        <Blocks delay={delay + 120} />
      </div>
      <p className="m-0 text-[14px] leading-[21px] text-pretty text-ink-2">
        A hash of this meeting's proof is now on NEAR, under <span className="font-mono text-[13px] text-ink">{onChain.owner}</span>. Not what was said: only
        the hash and the model's name. Anyone with the proof link can check your notes against it.
      </p>
      <dl className="m-0 flex flex-col border-t border-hairline pt-3 text-[13px] leading-[19px]">
        <div className="flex min-h-8 items-center gap-4">
          <dt className="w-[88px] shrink-0 text-muted">Transaction</dt>
          <dd className="m-0 flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="t-mono selectable truncate text-ink" title={onChain.txHash}>
              {short(onChain.txHash)}
            </span>
            <Button size="sm" onClick={() => openLink(explorerTx(onChain.network, onChain.txHash))}>
              View on NearBlocks
              <ExternalLink size={13} strokeWidth={2} aria-hidden="true" className="text-muted" />
            </Button>
          </dd>
        </div>
        {fee && (
          <div className="flex min-h-8 items-center gap-4">
            <dt className="w-[88px] shrink-0 text-muted">Fee</dt>
            <dd className="m-0 text-ink-2">
              <span className="font-mono text-ink tabular-nums">{fee}</span> {testnet ? "test NEAR" : "NEAR"}, paid from this Mac's fee allowance
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Four blocks in a row; the last, this proof's, fills verdigris. Decorative. */
function Blocks({ delay }: { delay: number }) {
  return (
    <span aria-hidden="true" className="mt-1 flex shrink-0 items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-2.5 rounded-[3px] shadow-[inset_0_0_0_1.5px_var(--border)]" style={at(delay + i * 70, "ac-pop", 240)} />
      ))}
      <span className="h-px w-2 bg-border" style={at(delay + 210, "ac-pop", 240)} />
      <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] bg-verdigris" style={at(delay + 260, "ac-fill", 420)}>
        <svg width="12" height="12" viewBox="0 0 22 22">
          <path
            d="M6.5 11.5l3 3 6-6.5"
            fill="none"
            stroke="var(--on-verdigris)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="14"
            style={{ animation: `ac-draw 240ms ${delay + 520}ms var(--ease) both` }}
          />
        </svg>
      </span>
    </span>
  );
}
