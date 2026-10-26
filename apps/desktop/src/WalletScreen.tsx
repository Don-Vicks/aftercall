import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { formatUsdc, type Meeting, type OwnerAction, type PaymentFollowUp } from "@aftercall/core";
import { contractFollowupId, near, signInWallet, waitFor, type WalletView } from "./near";
import { Button, SectionLabel, Spinner, cx } from "./ui";

/** "12.5" -> 12500000n base units; null if it isn't a plain positive amount. */
export function parseUsdcInput(text: string): bigint | null {
  const m = text.trim().replace(/,/g, "").match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export interface BlockedPayment {
  meeting: Meeting;
  followUp: PaymentFollowUp;
}

/**
 * The agent wallet, read live from the contract. Every change opens the signing
 * page, because only the owner's own wallet can make it; the screen refreshes
 * itself once the change lands.
 */
export function WalletScreen({
  blocked,
  onOpenSettings,
  onResolved,
}: {
  blocked: BlockedPayment[];
  onOpenSettings: () => void;
  /** A blocked payment was paid (approved) or dismissed (declined) on NEAR. */
  onResolved: (meetingId: string, followUpId: string, status: "paid" | "dismissed") => void;
}) {
  const [view, setView] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"deposit" | "withdraw" | "payee" | null>(null);
  const [capText, setCapText] = useState("");
  const [paymentCapText, setPaymentCapText] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const config = await near.getConfig();
      if (!config) return setConnected(false);
      setConnected(true);
      const v = await near.wallet();
      setView(v);
      if (v.wallet) {
        setCapText(formatUsdc(BigInt(v.wallet.daily_cap)).replace(/,/g, ""));
        setPaymentCapText(formatUsdc(BigInt(v.wallet.per_payment_cap)).replace(/,/g, ""));
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Opens the signing page, then refreshes once the contract shows `done`. */
  const signAndWait = async (label: string, action: OwnerAction, done: (v: WalletView) => boolean | Promise<boolean>) => {
    setError(null);
    try {
      await signInWallet(action);
      setWaiting(label);
      const landed = await waitFor(async () => {
        const v = await near.wallet();
        setView(v);
        return done(v);
      });
      if (!landed) setError(`Didn't see "${label}" on NEAR yet. If you signed, refresh in a moment.`);
      return landed;
    } catch (e) {
      setError(String(e));
    } finally {
      setWaiting(null);
    }
  };

  if (connected === false) {
    return (
      <Shell>
        <p className="t-reading m-0 text-muted">Connect your NEAR account first: the agent wallet lives on NEAR, and only your wallet can change it.</p>
        <div>
          <Button variant="primary" onClick={onOpenSettings}>Connect NEAR</Button>
        </div>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <p className="m-0 flex items-center gap-2 text-muted">{error ? <span className="text-record">{error}</span> : <><Spinner /> Reading your wallet from NEAR…</>}</p>
      </Shell>
    );
  }

  const w = view.wallet;
  if (!w) {
    return (
      <Shell>
        <p className="t-reading m-0 text-muted">You don't have an agent wallet on this contract yet.</p>
        <div>
          <Button variant="primary" disabled={!!waiting} onClick={() => signAndWait("Create wallet", { kind: "register" }, (v) => v.wallet !== null)}>
            {waiting ? <Spinner size={12} /> : null}
            Create agent wallet in your wallet
          </Button>
        </div>
        {error && <p className="m-0 text-record">{error}</p>}
      </Shell>
    );
  }

  const cap = BigInt(w.daily_cap);
  const spent = BigInt(w.spent_today);
  const today = Math.floor(Date.now() / 86_400_000);
  const spentToday = w.day === today ? spent : 0n;
  const pct = cap > 0n ? Number((spentToday * 100n) / cap) : 0;

  return (
    <Shell
      actions={
        <>
          <button onClick={load} aria-label="Refresh" className="text-muted hover:text-ink">
            <RefreshCw size={15} />
          </button>
          <Button onClick={() => setSheet("withdraw")}>Withdraw</Button>
          <Button variant="primary" onClick={() => setSheet("deposit")}>Deposit USDC</Button>
        </>
      }
    >
      {waiting && (
        <div role="status" className="flex items-center gap-3 rounded-sm bg-well px-4 py-3 text-muted">
          <Spinner /> Waiting for you to sign “{waiting}” in your wallet. This page updates when it lands on NEAR.
        </div>
      )}
      {error && <p className="selectable m-0 break-words text-record">{error}</p>}
      {w.paused && (
        <div className="flex items-center justify-between gap-3 rounded-sm bg-caution-tint px-4 py-3 text-caution">
          <span>Payments are paused. Aftercall can't pay anyone until you resume.</span>
          <Button onClick={() => signAndWait("Resume payments", { kind: "pause", paused: false }, (v) => v.wallet?.paused === false)}>Resume</Button>
        </div>
      )}

      <div className="grid grid-cols-3 border-y border-hairline">
        <div className="flex flex-col gap-1.5 py-5 pr-6">
          <span className="t-label text-muted">Balance</span>
          <span className="t-figure">
            {formatUsdc(BigInt(w.balance))} <span className="text-[13px] text-muted">USDC</span>
          </span>
        </div>
        <div className="flex flex-col gap-2.5 border-l border-hairline px-6 py-5">
          <span className="t-label text-muted">Spent today</span>
          <span className="font-mono text-[15px]">
            {formatUsdc(spentToday)} <span className="text-muted">of {formatUsdc(cap)}</span>
          </span>
          <div aria-hidden="true" className="h-1 rounded-full bg-hairline">
            <div className="h-1 rounded-full bg-verdigris" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-l border-hairline py-5 pl-6">
          <CapField
            label="Daily cap"
            value={capText}
            onChange={setCapText}
            onSave={() => {
              const v = parseUsdcInput(capText);
              if (v !== null) signAndWait("Set daily cap", { kind: "set-cap", dailyCap: v.toString() }, (x) => x.wallet?.daily_cap === v.toString());
            }}
          />
          <CapField
            label="Per payment (autopilot)"
            value={paymentCapText}
            onChange={setPaymentCapText}
            onSave={() => {
              const v = parseUsdcInput(paymentCapText);
              if (v !== null) signAndWait("Set per-payment limit", { kind: "set-payment-cap", perPaymentCap: v.toString() }, (x) => x.wallet?.per_payment_cap === v.toString());
            }}
          />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionLabel>Waiting for you</SectionLabel>
        {blocked.length === 0 ? (
          <p className="m-0 text-muted">No blocked payments. Anything over your caps waits here for your wallet.</p>
        ) : (
          blocked.map(({ meeting, followUp: f }) => {
            const id = contractFollowupId(meeting.id, f.id);
            return (
              <div key={id} className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-md bg-caution-tint px-5 py-4">
                <AlertTriangle size={16} strokeWidth={1.5} className="text-caution" aria-hidden="true" />
                <div className="flex min-w-[300px] flex-1 flex-col gap-0.5">
                  <span className="t-title">
                    <span className="font-mono text-sm font-normal">{f.amount === null ? "?" : formatUsdc(f.amount)} USDC</span> to {f.payeeAccount}
                  </span>
                  <span className="text-caution">Blocked: over your limits. Approving signs in your wallet and pays past the cap once.</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      signAndWait("Decline payment", { kind: "cancel", followupId: id, payee: f.payeeAccount, amount: String(f.amount ?? 0n) }, async () => !(await near.paymentState(id)).pending).then(
                        (ok) => ok && onResolved(meeting.id, f.id, "dismissed"),
                      )
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    className="border-caution text-caution"
                    onClick={() =>
                      signAndWait(
                        "Approve payment",
                        {
                          kind: "approve",
                          followupId: id,
                          payee: f.payeeAccount,
                          amount: String(f.amount ?? 0n),
                          context: { payeeName: f.payeeName, meeting: `${meeting.title} · ${meeting.startedAt}`, heard: f.heard, leftToday: `${formatUsdc(cap > spentToday ? cap - spentToday : 0n)} of ${formatUsdc(cap)}` },
                        },
                        async () => (await near.paymentState(id)).paid,
                      ).then((ok) => ok && onResolved(meeting.id, f.id, "paid"))
                    }
                  >
                    Approve in wallet
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </section>

      <div className="flex flex-wrap gap-10">
        <section className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Payees</SectionLabel>
            <button onClick={() => setSheet("payee")} className="font-semibold text-verdigris hover:text-verdigris-hover">
              Add payee
            </button>
          </div>
          {view.payees.length === 0 ? (
            <p className="m-0 text-muted">No payees yet. Aftercall can only pay people on this list.</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {view.payees.map((p, i) => (
                  <tr key={p.account}>
                    <td className={cx("border-t border-hairline py-3 font-semibold", i === view.payees.length - 1 && "border-b")}>{p.label}</td>
                    <td className={cx("t-mono border-t border-hairline px-4 py-3 text-muted", i === view.payees.length - 1 && "border-b")}>{p.account}</td>
                    <td className={cx("border-t border-hairline py-3 text-right", i === view.payees.length - 1 && "border-b")}>
                      <button
                        onClick={() => signAndWait("Remove payee", { kind: "remove-payee", account: p.account, label: p.label }, (v) => !v.payees.some((x) => x.account === p.account))}
                        className="text-muted hover:text-ink"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="flex flex-[1_1_260px] flex-col gap-3">
          <SectionLabel>This Mac's key</SectionLabel>
          <div className="flex flex-col gap-2.5 border-t border-hairline pt-3">
            <span className="t-title">Limited key, in Keychain</span>
            <span className="text-muted">
              Can call only <span className="t-mono text-ink">pay</span> and <span className="t-mono text-ink">record_proof</span>. It can't raise the cap, add payees or withdraw.
            </span>
            {!w.paused && (
              <Button className="mt-1 self-start" onClick={() => signAndWait("Pause payments", { kind: "pause", paused: true }, (v) => v.wallet?.paused === true)}>
                Pause all payments
              </Button>
            )}
          </div>
        </section>
      </div>

      {sheet === "deposit" && (
        <AmountSheet
          title="Deposit USDC"
          intro="Moves USDC from your NEAR account into your agent wallet. Your wallet signs it."
          hint={async () => `You have ${formatUsdc(BigInt(await near.ownerUsdc()))} USDC on ${(await near.getConfig())?.account}.`}
          confirm="Deposit in wallet"
          onClose={() => setSheet(null)}
          onConfirm={(amount) => {
            setSheet(null);
            const before = BigInt(w.balance);
            signAndWait("Deposit", { kind: "deposit", amount: amount.toString() }, (v) => BigInt(v.wallet?.balance ?? "0") > before);
          }}
        />
      )}
      {sheet === "withdraw" && (
        <AmountSheet
          title="Withdraw USDC"
          intro="Moves USDC from your agent wallet back to your NEAR account. Your wallet signs it."
          hint={async () => `${formatUsdc(BigInt(w.balance))} USDC in your agent wallet.`}
          confirm="Withdraw in wallet"
          onClose={() => setSheet(null)}
          onConfirm={(amount) => {
            setSheet(null);
            const before = BigInt(w.balance);
            signAndWait("Withdraw", { kind: "withdraw", amount: amount.toString() }, (v) => BigInt(v.wallet?.balance ?? "0") < before);
          }}
        />
      )}
      {sheet === "payee" && (
        <PayeeSheet
          onClose={() => setSheet(null)}
          onConfirm={(account, label, registerWithUsdc) => {
            setSheet(null);
            signAndWait("Add payee", { kind: "add-payee", account, label, registerWithUsdc }, (v) => v.payees.some((p) => p.account === account));
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-ground">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-ground" />
      <div className="mx-auto flex max-w-[960px] flex-col gap-10 px-12 pb-16">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[520px] flex-col gap-2.5">
            <h1 className="t-display m-0">Agent wallet</h1>
            <p className="t-reading m-0 text-muted">
              A spending-limit wallet you control. Aftercall can pay only the people below, up to your caps. Every change is signed in your NEAR wallet.
            </p>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </main>
  );
}

function CapField({ label, value, onChange, onSave }: { label: string; value: string; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="t-label text-muted">{label}</label>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="selectable h-8 min-w-0 flex-1 rounded-sm border border-border bg-well px-2.5 font-mono text-xs text-ink outline-none"
        />
        <Button onClick={onSave} disabled={parseUsdcInput(value) === null}>Save</Button>
      </div>
    </div>
  );
}

function Sheet({ title, intro, children, onClose }: { title: string; intro: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex w-[560px] flex-col gap-5 rounded-lg bg-elevated p-8 shadow-float">
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 font-serif text-[28px] leading-[34px] font-medium tracking-[-0.015em]">{title}</h2>
          <p className="m-0 text-muted">{intro}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function AmountSheet({
  title,
  intro,
  hint,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string;
  intro: string;
  hint: () => Promise<string>;
  confirm: string;
  onClose: () => void;
  onConfirm: (amount: bigint) => void;
}) {
  const [text, setText] = useState("");
  const [hintText, setHintText] = useState("");
  useEffect(() => {
    hint().then(setHintText).catch(() => {});
  }, [hint]);
  const amount = parseUsdcInput(text);
  return (
    <Sheet title={title} intro={intro} onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className="t-label text-muted">Amount (USDC)</label>
        <input id="amount" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="100.00" className="selectable h-9 rounded-sm border border-border bg-well px-3 font-mono text-[13px] text-ink outline-none" />
        {hintText && <span className="text-muted">{hintText}</span>}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!amount} onClick={() => amount && onConfirm(amount)}>{confirm}</Button>
      </div>
    </Sheet>
  );
}

function PayeeSheet({ onClose, onConfirm }: { onClose: () => void; onConfirm: (account: string, label: string, registerWithUsdc: boolean) => void }) {
  const [account, setAccount] = useState("");
  const [label, setLabel] = useState("");
  const [check, setCheck] = useState<{ exists: boolean; usdcReady: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setCheck(null);
    if (account.length < 2) return;
    const t = setTimeout(async () => {
      setChecking(true);
      setCheck(await near.checkPayee(account).catch(() => null));
      setChecking(false);
    }, 500);
    return () => clearTimeout(t);
  }, [account]);

  return (
    <Sheet title="Add a payee" intro="Aftercall can only pay people on this list. Adding one is signed in your wallet." onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="acct" className="t-label text-muted">NEAR account</label>
        <input
          id="acct"
          autoFocus
          value={account}
          onChange={(e) => setAccount(e.target.value.trim().toLowerCase())}
          placeholder="name.testnet"
          className={cx("selectable h-9 rounded-sm border bg-well px-3 font-mono text-[13px] text-ink outline-none", check?.exists ? "border-verdigris" : "border-border")}
        />
        {checking ? (
          <span className="text-muted">Looking it up on NEAR…</span>
        ) : check ? (
          check.exists ? <span className="text-verdigris">Account found on NEAR</span> : <span className="text-caution">No such account on NEAR</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lbl" className="t-label text-muted">Label</label>
        <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Designer" className="selectable h-9 rounded-sm border border-border bg-well px-3 text-sm text-ink outline-none" />
        <span className="text-muted">How the AI names them, as in “pay the designer”.</span>
      </div>
      {check?.exists && !check.usdcReady && (
        <div className="flex flex-col gap-1 rounded-md bg-caution-tint px-3.5 py-3">
          <span className="font-semibold">{account} can't receive USDC yet</span>
          <span className="text-caution">Registering it costs 0.00125 NEAR, paid once from your wallet in the same signing.</span>
        </div>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!check?.exists || label.trim().length === 0} onClick={() => onConfirm(account, label.trim(), !check?.usdcReady)}>
          {check && !check.usdcReady ? "Add and register in wallet" : "Add in wallet"}
        </Button>
      </div>
    </Sheet>
  );
}

