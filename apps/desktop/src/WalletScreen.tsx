import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Check, Pause, Play, Plus, RefreshCw } from "lucide-react";
import { CHAIN_NAME, exampleAccount, formatUsdc, isValidPayoutAddress, type Meeting, type Network, type OwnerAction, type PayeeDestination, type PaymentFollowUp, type PayoutChain } from "@aftercall/core";
import { contractFollowupId, near, signInWallet, waitFor, type WalletView } from "./near";
import { Avatar, Button, Card, Dialog, Field, IconButton, Input, LayoutMotion, Pill, RollingNumber, SectionTitle, Spinner, cx, enter, exit, springs, toast } from "./ui";
import { isDesktop } from "./recorder";

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

const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms var(--ease) ${i * 40}ms both` });
const plain = (n: bigint) => formatUsdc(n).replace(/,/g, "");
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * The agent wallet, read live from the contract. Every change opens the signing
 * page, because only the owner's own wallet can make it; the screen refreshes
 * itself once the change lands on NEAR.
 */
export function WalletScreen({
  blocked,
  onOpenSettings,
  onResolved,
  onChanged,
}: {
  blocked: BlockedPayment[];
  onOpenSettings: () => void;
  /** A blocked payment was paid (approved) or dismissed (declined) on NEAR. */
  onResolved: (meetingId: string, followUpId: string, status: "paid" | "dismissed") => void;
  /** A signed change landed: the balance, payees or caps may be different now. */
  onChanged?: () => void;
}) {
  const [view, setView] = useState<WalletView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [network, setNetwork] = useState<Network>("testnet");
  const [contract, setContract] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"deposit" | "withdraw" | "payee" | null>(null);
  const [capText, setCapText] = useState("");
  const [paymentCapText, setPaymentCapText] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    if (!isDesktop) {
      // The browser preview shows a sample wallet, like the sample meeting, so the page can be seen.
      setConnected(true);
      setView(SAMPLE_WALLET);
      setCapText(plain(BigInt(SAMPLE_WALLET.wallet!.daily_cap)));
      setPaymentCapText(plain(BigInt(SAMPLE_WALLET.wallet!.per_payment_cap)));
      return;
    }
    try {
      const config = await near.getConfig();
      if (!config) return setConnected(false);
      setConnected(true);
      setNetwork(config.network);
      setContract(config.contract);
      const v = await near.wallet();
      setView(v);
      if (v.wallet) {
        setCapText(plain(BigInt(v.wallet.daily_cap)));
        setPaymentCapText(plain(BigInt(v.wallet.per_payment_cap)));
      }
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Opens the signing page, then refreshes once the contract shows `done`; says what changed. */
  const signAndWait = async (label: string, action: OwnerAction, done: (v: WalletView) => boolean | Promise<boolean>, said: (v: WalletView) => string): Promise<boolean> => {
    if (!isDesktop) {
      toast({ text: `“${label}” is signed in your NEAR wallet, from the Mac app. This is sample data, so nothing changed.`, tone: "caution" });
      return false;
    }
    try {
      await signInWallet(action);
      setWaiting(label);
      let last: WalletView | null = null;
      const landed = await waitFor(async () => {
        const v = await near.wallet();
        last = v;
        setView(v);
        return done(v);
      });
      if (landed && last) {
        toast({ text: said(last), tone: "verdigris" });
        onChanged?.();
      } else toast({ text: `Didn't see “${label}” on NEAR yet. If you signed, refresh in a moment.`, tone: "caution" });
      return landed;
    } catch (e) {
      toast({ text: `${label} didn't go through: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
      return false;
    } finally {
      setWaiting(null);
    }
  };

  const eyebrow = !isDesktop ? "Sample wallet · browser preview" : contract ? `${contract} · NEAR ${network}` : "NEAR";

  if (connected === false) {
    return (
      <Shell eyebrow="Not connected">
        <p className="m-0 text-ink-2">Connect your NEAR account first: the agent wallet lives on NEAR, and only your wallet can change it.</p>
        <div>
          <Button variant="primary" onClick={onOpenSettings}>
            Connect NEAR
          </Button>
        </div>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell eyebrow={eyebrow} onRefresh={loadError ? load : undefined}>
        {loadError ? (
          <p className="selectable m-0 break-words text-record">{loadError}</p>
        ) : (
          <p role="status" className="m-0 flex items-center gap-2 text-ink-2">
            <Spinner /> Reading your wallet from NEAR…
          </p>
        )}
      </Shell>
    );
  }

  const w = view.wallet;
  if (!w) {
    return (
      <Shell eyebrow={eyebrow} onRefresh={load}>
        <p className="m-0 text-ink-2">You don't have an agent wallet on this contract yet.</p>
        <div>
          <Button
            variant="primary"
            loading={Boolean(waiting)}
            onClick={() => signAndWait("Create wallet", { kind: "register" }, (v) => v.wallet !== null, () => "Agent wallet created on NEAR")}
          >
            Create agent wallet in your wallet
          </Button>
        </div>
        <SigningPill label={waiting} />
      </Shell>
    );
  }

  const balance = BigInt(w.balance);
  const cap = BigInt(w.daily_cap);
  const perCap = BigInt(w.per_payment_cap);
  const today = Math.floor(Date.now() / 86_400_000);
  const spentToday = w.day === today ? BigInt(w.spent_today) : 0n;
  const left = cap > spentToday ? cap - spentToday : 0n;
  const pct = cap > 0n ? Number((spentToday * 1000n) / cap) / 10 : 0;
  const busy = Boolean(waiting);

  return (
    <Shell eyebrow={eyebrow} sample={!isDesktop} onRefresh={load}>
      <Card pad="lg" className="flex flex-col gap-5" style={rise(1)}>
        <section aria-label="Balance" className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-muted">Balance</span>
            <Balance value={balance} />
          </div>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => setSheet("withdraw")}>
              Withdraw
            </Button>
            <Button variant="primary" disabled={busy} icon={<Plus size={14} strokeWidth={2.25} aria-hidden="true" />} onClick={() => setSheet("deposit")}>
              Deposit
            </Button>
          </div>
        </section>
        <div className="flex flex-col gap-2 border-t border-hairline pt-[18px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">Spent today</span>
            <span className="font-mono text-[13px]">
              {formatUsdc(spentToday)} <span className="text-muted">of {formatUsdc(cap)}</span>
            </span>
          </div>
          <div role="img" aria-label={`${formatUsdc(spentToday)} of ${formatUsdc(cap)} USDC spent today`} className="h-1.5 overflow-hidden rounded-full bg-well">
            <div className="h-1.5 rounded-full bg-verdigris transition-[width] duration-(--dur-3) ease-calm" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="text-xs text-muted">
            <span className="font-mono">{formatUsdc(left)}</span> left today
          </span>
        </div>
      </Card>

      <section aria-labelledby="h-limits" className="flex flex-col gap-3.5" style={rise(2)}>
        <SectionTitle id="h-limits" count="signed by you">
          Limits
        </SectionTitle>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <CapField
            label="Daily cap"
            hint="Everything Aftercall pays in a day, together."
            value={capText}
            saved={cap}
            busy={busy}
            onChange={setCapText}
            onSave={(v) =>
              signAndWait("Set daily cap", { kind: "set-cap", dailyCap: v.toString() }, (x) => x.wallet?.daily_cap === v.toString(), () => `Daily cap is ${formatUsdc(v)} USDC on NEAR`)
            }
          />
          <CapField
            label="Per payment, for autopilot"
            hint="Bigger payments wait for you to approve."
            value={paymentCapText}
            saved={perCap}
            busy={busy}
            onChange={setPaymentCapText}
            onSave={(v) =>
              signAndWait(
                "Set per-payment limit",
                { kind: "set-payment-cap", perPaymentCap: v.toString() },
                (x) => x.wallet?.per_payment_cap === v.toString(),
                () => `Autopilot pays up to ${formatUsdc(v)} USDC each`,
              )
            }
          />
        </div>
      </section>

      <section aria-labelledby="h-wait" className="flex flex-col gap-3.5" style={rise(3)}>
        <SectionTitle id="h-wait" count={blocked.length || undefined}>
          Waiting for you
        </SectionTitle>
        {blocked.length === 0 ? (
          <p className="m-0 text-ink-2">Nothing waiting. Payments over your caps wait here for your wallet.</p>
        ) : (
          blocked.map(({ meeting, followUp: f }) => {
            const id = contractFollowupId(meeting.id, f.id);
            const amount = f.amount === null ? "?" : formatUsdc(f.amount);
            return (
              <Card key={id} tone="caution" pad="none" className="flex flex-wrap items-center gap-4 px-[18px] py-4">
                <Avatar name={f.payeeName} size={36} decorative />
                <span className="flex min-w-0 flex-[1_1_300px] flex-col gap-0.5">
                  <span className="font-semibold">
                    Pay {f.payeeName} <span className="font-mono font-medium">{amount} USDC</span>
                  </span>
                  <span className="text-caution">Over your limits. Approving signs in your wallet and pays past the cap once.</span>
                </span>
                <Pill tone="caution" className="bg-raised">
                  Blocked
                </Pill>
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      signAndWait(
                        "Decline payment",
                        { kind: "cancel", followupId: id, payee: f.payeeAccount, amount: String(f.amount ?? 0n) },
                        async () => !(await near.paymentState(id)).pending,
                        () => `Declined paying ${f.payeeName} ${amount} USDC`,
                      ).then((ok) => ok && onResolved(meeting.id, f.id, "dismissed"))
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    className="border-caution text-caution! hover:bg-caution-tint!"
                    onClick={() =>
                      signAndWait(
                        "Approve payment",
                        {
                          kind: "approve",
                          followupId: id,
                          payee: f.payeeAccount,
                          amount: String(f.amount ?? 0n),
                          context: { payeeName: f.payeeName, meeting: `${meeting.title} · ${meeting.startedAt}`, heard: f.heard, leftToday: `${formatUsdc(left)} of ${formatUsdc(cap)}` },
                        },
                        async () => (await near.paymentState(id)).paid,
                        () => `Paid ${f.payeeName} ${amount} USDC`,
                      ).then((ok) => ok && onResolved(meeting.id, f.id, "paid"))
                    }
                  >
                    Review
                  </Button>
                </span>
              </Card>
            );
          })
        )}
      </section>

      <div className="flex flex-wrap gap-10" style={rise(4)}>
        <section aria-labelledby="h-payees" className="flex min-w-0 flex-[999_1_400px] flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <SectionTitle id="h-payees" count={view.payees.length}>
              Payees
            </SectionTitle>
            <button onClick={() => setSheet("payee")} disabled={busy} className="inline-flex items-center gap-1 text-[13px] font-semibold text-verdigris hover:text-verdigris-hover disabled:opacity-40">
              <Plus size={13} strokeWidth={2.25} aria-hidden="true" />
              Add payee
            </button>
          </div>
          {view.payees.length === 0 ? (
            <p className="m-0 text-ink-2">No payees yet. Aftercall can only pay people on this list.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
              {view.payees.map((p) => {
                const dest = (view.destinations ?? []).find((d) => d.payee === p.account);
                return (
                  <li key={p.account} className="flex items-center gap-3.5 border-b border-hairline py-3.5">
                    <Avatar name={p.label || p.account} size={32} decorative />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate font-semibold">{p.label}</span>
                      {dest ? (
                        <span className="truncate text-[13px] text-ink-2">
                          Paid on {CHAIN_NAME[dest.chain]} · <span className="font-mono">{short(dest.address)}</span>
                        </span>
                      ) : (
                        <span className="truncate font-mono text-[13px] text-muted">{p.account}</span>
                      )}
                    </span>
                    {dest && (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          signAndWait(
                            "Pay on NEAR only",
                            { kind: "set-payee-destination", account: p.account, label: p.label, destination: null },
                            (v) => !(v.destinations ?? []).some((d) => d.payee === p.account),
                            () => `${p.label} is paid on NEAR again`,
                          )
                        }
                      >
                        NEAR only
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        signAndWait(
                          "Remove payee",
                          { kind: "remove-payee", account: p.account, label: p.label },
                          (v) => !v.payees.some((x) => x.account === p.account),
                          () => `${p.label} is off your payee list`,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-key" className="flex flex-[1_1_240px] flex-col gap-2.5">
          <div className="flex min-h-5 items-center gap-2.5">
            <SectionTitle id="h-key">This Mac's key</SectionTitle>
            {w.paused && (
              <Pill tone="caution" className="[animation:ac-pop_280ms_var(--ease)_both]">
                Paused
              </Pill>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-hairline pt-3.5">
            <span className="font-semibold">Limited key, in your Keychain</span>
            <span className="text-ink-2">
              Can call only <span className="font-mono text-[13px] text-ink">pay</span> and <span className="font-mono text-[13px] text-ink">record_proof</span>. It can't raise a cap, add payees or
              withdraw.
            </span>
            {w.paused && <span className="text-caution">Aftercall can't pay anyone until you resume.</span>}
            <Button
              size="sm"
              className="mt-1 self-start"
              disabled={busy}
              icon={w.paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
              onClick={() =>
                w.paused
                  ? signAndWait("Resume payments", { kind: "pause", paused: false }, (v) => v.wallet?.paused === false, () => "Payments resumed on NEAR")
                  : signAndWait("Pause payments", { kind: "pause", paused: true }, (v) => v.wallet?.paused === true, () => "Payments paused on NEAR")
              }
            >
              {w.paused ? "Resume payments" : "Pause all payments"}
            </Button>
          </div>
        </section>
      </div>

      <SigningPill label={waiting} />

      <AnimatePresence>
        {sheet === "deposit" && (
          <AmountSheet
            key="deposit"
            title="Deposit USDC"
            intro="Moves USDC from your NEAR account into your agent wallet. Your wallet signs it."
            hint={async () => `You have ${formatUsdc(BigInt(await near.ownerUsdc()))} USDC on ${(await near.getConfig())?.account}.`}
            confirm="Deposit in wallet"
            onClose={() => setSheet(null)}
            onConfirm={(amount) => {
              setSheet(null);
              signAndWait("Deposit", { kind: "deposit", amount: amount.toString() }, (v) => BigInt(v.wallet?.balance ?? "0") > balance, () => `Deposited ${formatUsdc(amount)} USDC`);
            }}
          />
        )}
        {sheet === "withdraw" && (
          <AmountSheet
            key="withdraw"
            title="Withdraw USDC"
            intro="Moves USDC from your agent wallet back to your NEAR account. Your wallet signs it."
            hint={async () => `${formatUsdc(balance)} USDC in your agent wallet.`}
            confirm="Withdraw in wallet"
            onClose={() => setSheet(null)}
            onConfirm={(amount) => {
              setSheet(null);
              signAndWait("Withdraw", { kind: "withdraw", amount: amount.toString() }, (v) => BigInt(v.wallet?.balance ?? "0") < balance, () => `Withdrew ${formatUsdc(amount)} USDC`);
            }}
          />
        )}
        {sheet === "payee" && (
          <PayeeSheet
            key="payee"
            network={network}
            onClose={() => setSheet(null)}
            onConfirm={(account, label, registerWithUsdc, destination) => {
              setSheet(null);
              signAndWait(
                "Add payee",
                { kind: "add-payee", account, label, registerWithUsdc, destination },
                (v) => v.payees.some((p) => p.account === account) && (!destination || (v.destinations ?? []).some((d) => d.payee === account && d.address === destination.address)),
                () => `${label} can be paid now`,
              );
            }}
          />
        )}
      </AnimatePresence>
    </Shell>
  );
}

/** What the browser preview shows: a wallet part-way through a day, with one payee on Solana. */
const SAMPLE_WALLET: WalletView = {
  wallet: {
    balance: "412500000",
    daily_cap: "100000000",
    spent_today: "50000000",
    day: Math.floor(Date.now() / 86_400_000),
    paused: false,
    pending_count: 1,
    storage_credit: "0",
    per_payment_cap: "25000000",
  },
  payees: [
    { account: "designer.near", label: "Designer" },
    { account: "ada.near", label: "Ada" },
  ],
  destinations: [{ payee: "ada.near", chain: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }],
};

function Shell({ eyebrow, sample, onRefresh, children }: { eyebrow: string; sample?: boolean; onRefresh?: () => void; children: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-12 pt-5 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div className="flex max-w-[560px] flex-col gap-1.5">
            <span className="t-eyebrow text-muted">{eyebrow}</span>
            <div className="flex items-center gap-3">
              <h1 className="t-display m-0">Agent wallet</h1>
              {sample && <Pill tone="muted">Sample</Pill>}
            </div>
            <p className="m-0 text-ink-2">Aftercall pays only the people below, within your caps. Every change is signed in your wallet.</p>
          </div>
          {onRefresh && (
            <IconButton aria-label="Refresh from NEAR" tooltipSide="bottom" onClick={onRefresh}>
              <RefreshCw size={16} strokeWidth={1.75} />
            </IconButton>
          )}
        </header>
        {children}
      </div>
    </main>
  );
}

/** The hero balance. Its digits roll when it changes; a deposit that lands floats "+25.00" off it. */
function Balance({ value }: { value: bigint }) {
  const before = useRef(value);
  const [chip, setChip] = useState<{ key: number; text: string } | null>(null);
  useEffect(() => {
    if (value > before.current) setChip({ key: Date.now(), text: `+${formatUsdc(value - before.current)}` });
    before.current = value;
  }, [value]);
  useEffect(() => {
    if (!chip) return;
    const t = setTimeout(() => setChip(null), 1700);
    return () => clearTimeout(t);
  }, [chip]);
  return (
    <span className="relative inline-flex items-baseline gap-2.5 self-start">
      <RollingNumber value={formatUsdc(value)} className="t-figure-xl" />
      <span aria-hidden="true" className="font-mono text-[15px] text-muted">
        USDC
      </span>
      {chip && (
        <span
          key={chip.key}
          aria-hidden="true"
          className="absolute top-1.5 left-full ml-2.5 inline-flex h-[26px] items-center rounded-full bg-verdigris-tint px-2.5 font-mono text-[13px] font-medium whitespace-nowrap text-verdigris"
          style={{ animation: "ac-rise 1600ms var(--ease) both" }}
        >
          {chip.text}
        </span>
      )}
    </span>
  );
}

/** "Waiting for you to sign …" while a change is out for signing; it lands as a toast. */
function SigningPill({ label }: { label: string | null }) {
  return (
    <div className="pointer-events-none fixed right-0 bottom-7 left-[248px] z-40 flex justify-center px-4">
      <AnimatePresence>
        {label && (
          <m.div
            key="signing"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            className="flex items-center gap-2.5 rounded-full bg-elevated px-4 py-2.5 shadow-pill"
          >
            <Spinner size={14} />
            <span>
              Waiting for you to sign “{label}” in your wallet. This page updates when it lands on NEAR.
            </span>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CapField({
  label,
  hint,
  value,
  saved,
  busy,
  onChange,
  onSave,
}: {
  label: string;
  hint: string;
  value: string;
  saved: bigint;
  busy: boolean;
  onChange: (v: string) => void;
  onSave: (v: bigint) => void;
}) {
  const parsed = parseUsdcInput(value);
  const off = busy || parsed === null || parsed === saved;
  return (
    <Field label={label} hint={hint} error={value.trim() && parsed === null ? "Type an amount, like 200.00" : undefined} className="min-w-0 flex-[1_1_260px]">
      <div className="flex gap-2">
        <span className="relative flex min-w-0 flex-1">
          <Input mono value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !off && onSave(parsed)} className="pr-14" />
          <span aria-hidden="true" className="pointer-events-none absolute top-0 right-3 font-mono text-xs leading-9 text-muted">
            USDC
          </span>
        </span>
        <Button disabled={off} onClick={() => parsed !== null && onSave(parsed)}>
          Save
        </Button>
      </div>
    </Field>
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
    if (isDesktop) hint().then(setHintText).catch(() => {});
  }, [hint]);
  const amount = parseUsdcInput(text);
  const ok = amount !== null && amount > 0n;
  return (
    <Dialog title={title} intro={intro} onClose={onClose}>
      <Field label="Amount" hint={hintText || undefined} error={text.trim() && !ok ? "Type an amount, like 25.00" : undefined}>
        <span className="relative flex">
          <Input mono autoFocus value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && onConfirm(amount)} placeholder="25.00" className="pr-14" />
          <span aria-hidden="true" className="pointer-events-none absolute top-0 right-3 font-mono text-xs leading-9 text-muted">
            USDC
          </span>
        </span>
      </Field>
      <div className="flex justify-end gap-2 pt-0.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!ok} onClick={() => ok && onConfirm(amount)}>
          {confirm}
        </Button>
      </div>
    </Dialog>
  );
}

type PaidOn = "near" | PayoutChain;

/** A segmented choice (radiogroup): arrow keys move and pick; the selected one has a sliding thumb. */
function Segmented<T extends string>({ labelledBy, value, options, onChange }: { labelledBy: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length].value;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <LayoutMotion>
      <div role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="grid grid-cols-3 gap-1 rounded-[10px] bg-well p-1">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[o.value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cx("press relative isolate h-8 rounded-[7px] font-semibold", on ? "text-ink" : "text-ink-2 hover:text-ink")}
            >
              {on && <m.span layoutId={`${labelledBy}-thumb`} aria-hidden="true" transition={springs.snappy} className="absolute inset-0 -z-10 rounded-[7px] bg-elevated shadow-1" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </LayoutMotion>
  );
}

function PayeeSheet({
  network,
  onClose,
  onConfirm,
}: {
  network: Network;
  onClose: () => void;
  onConfirm: (account: string, label: string, registerWithUsdc: boolean, destination?: PayeeDestination) => void;
}) {
  const [account, setAccount] = useState("");
  const [label, setLabel] = useState("");
  const [paidOn, setPaidOn] = useState<PaidOn>("near");
  const [address, setAddress] = useState("");
  const external = paidOn !== "near";
  const addressOk = !external || isValidPayoutAddress(paidOn, address);
  const [check, setCheck] = useState<{ exists: boolean; usdcReady: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const paidOnId = useId();
  const name = label.trim().split(/\s+/)[0] || "the payee";

  useEffect(() => {
    setCheck(null);
    if (account.length < 2 || !isDesktop) return;
    const t = setTimeout(async () => {
      setChecking(true);
      setCheck(await near.checkPayee(account).catch(() => null));
      setChecking(false);
    }, 500);
    return () => clearTimeout(t);
  }, [account]);

  const lookup = checking ? (
    <span className="text-muted">Looking it up on NEAR…</span>
  ) : check ? (
    check.exists ? (
      <span className="inline-flex items-center gap-1.5 font-medium text-verdigris">
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />
        Account found on NEAR
      </span>
    ) : external ? (
      <span>Not on NEAR. That's fine for a payee paid on another chain: the contract only uses it as their name.</span>
    ) : (
      <span className="text-caution">No such account on NEAR</span>
    )
  ) : !isDesktop && account.length >= 2 ? (
    <span>Checked on NEAR in the Mac app.</span>
  ) : undefined;

  const register = !external && check?.exists && !check.usdcReady;
  const ok = Boolean(check) && (external || check!.exists) && label.trim().length > 0 && addressOk && (!external || Boolean(address));

  return (
    <Dialog title="Add a payee" intro="Aftercall can only pay people on this list." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="NEAR account" hint={lookup}>
          <Input
            mono
            autoFocus
            value={account}
            onChange={(e) => setAccount(e.target.value.trim().toLowerCase())}
            placeholder={exampleAccount(network, "name")}
            className={cx(check?.exists && "border-verdigris")}
          />
        </Field>
        <Field label="Label" hint={`How the AI names them, as in “pay ${label.trim() ? name : "the designer"}”.`}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Designer" />
        </Field>
        <div className="flex flex-col gap-2">
          <span id={paidOnId} className="text-[13px] leading-[18px] font-semibold">
            Paid on
          </span>
          <Segmented
            labelledBy={paidOnId}
            value={paidOn}
            onChange={setPaidOn}
            options={[
              { value: "near", label: "NEAR" },
              { value: "solana", label: "Solana" },
              { value: "base", label: "Base" },
            ]}
          />
          {external && (
            <Field
              label={`${CHAIN_NAME[paidOn]} address`}
              hideLabel
              error={address && !addressOk ? `That isn't a ${CHAIN_NAME[paidOn]} address.` : undefined}
              hint={
                <>
                  Paid out by NEAR Intents. Use only an address {label.trim() ? name : "they"} gave you.{" "}
                  <details className="inline">
                    <summary className="inline cursor-pointer font-semibold text-verdigris">Why?</summary>
                    <span className="mt-1 block">
                      USDC leaves your agent wallet on NEAR, within your caps, and NEAR Intents pays it out on {CHAIN_NAME[paidOn]}. Aftercall can't prove where NEAR Intents sends it. NEAR
                      mainnet only.
                    </span>
                  </details>
                </>
              }
            >
              <Input mono value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder={paidOn === "base" ? "0x…" : "Solana address"} />
            </Field>
          )}
        </div>
        {register && (
          <div className="flex flex-col gap-1 rounded-sm bg-caution-tint px-3.5 py-3">
            <span className="font-semibold">{account} can't receive USDC yet</span>
            <span className="text-caution">Registering it costs 0.00125 NEAR, paid once from your wallet in the same signing.</span>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-0.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!ok}
          onClick={() => onConfirm(account, label.trim(), Boolean(register), external ? { chain: paidOn, address } : undefined)}
        >
          {register ? "Add and register in wallet" : "Add in wallet"}
        </Button>
      </div>
    </Dialog>
  );
}
