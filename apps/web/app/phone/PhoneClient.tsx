"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PHONE_POLL_MS,
  PHONE_UNDO_MS,
  afterHello,
  clockTime,
  countdownText,
  deviceLabel,
  forgetTap,
  groupCode,
  helloAttempt,
  inOrder,
  itemAmount,
  itemKey,
  itemTitle,
  macOfflineSince,
  meetingLabel,
  pairingLinkStep,
  phoneAction,
  phoneChoices,
  phoneRelay,
  routeText,
  shortDate,
  signUrlsMatch,
  startOfDay,
  startPhonePairing,
  takeSnapshot,
  tapHolds,
  tapState,
  tapText,
  type PendingItem,
  type PhonePairing,
  type Snapshot,
} from "@aftercall/core";
import { Avatar, Icon, Logo, Pill, Tick } from "../ui";
import { clearPairing, loadPairing, savePairing } from "./store";
import p from "./phone.module.css";

/**
 * The phone companion (docs/design/phone.md, version 1; protocol in
 * docs/design/phone-protocol.md). It pairs with the Mac from the QR's link, shows what
 * waits for you, and sends back Approve, Dismiss and Undo, sealed to the Mac. The relay
 * only ever sees sealed boxes; nothing this page decrypts is sent anywhere or logged.
 * The decisions live in @aftercall/core (relay/phone.ts); this file stores and draws.
 */

type Problem = "bad-link" | "taken" | "cancelled" | "unpaired" | "first-unreadable";
type Screen = { kind: "loading" } | { kind: "none"; problem?: Problem } | { kind: "replace"; fresh: PhonePairing } | { kind: "pairing" } | { kind: "code" } | { kind: "inbox" };
type Hold = { kind: "approve" | "dismiss"; until: number; item: PendingItem };

interface Net {
  /** When the relay last heard from the Mac (relay clock), if that's over a minute ago. */
  offlineSince: number | null;
  /** The last snapshot box didn't open; the page shows the last good one. */
  unreadable: boolean;
  /** The relay didn't answer. */
  unreachable: boolean;
}

const PROBLEMS: Record<Problem, { title: string; body: string }> = {
  "bad-link": { title: "This pairing code didn't work", body: "It may be cut short, or from another version of Aftercall. Make a new one on your Mac." },
  taken: { title: "Someone else used this code", body: "Cancel on your Mac and make a new one." },
  cancelled: { title: "Pairing stopped", body: "Your Mac cancelled it, or the code ran out after 10 minutes. Make a new one on your Mac." },
  unpaired: { title: "This phone isn't paired any more", body: "Your Mac unpaired it, or it wasn't used for 30 days. Pair again from your Mac." },
  "first-unreadable": { title: "Couldn't read your Mac's first update", body: "Nothing was shown or sent. Cancel on your Mac and pair again." },
};

export function PhoneClient() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [pairing, setPairing] = useState<PhonePairing | null>(null);
  const [kept, setKept] = useState(true);
  const [net, setNet] = useState<Net>({ offlineSince: null, unreadable: false, unreachable: false });
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [holds, setHolds] = useState<Record<string, Hold>>({});
  const [tapErrors, setTapErrors] = useState<Record<string, string>>({});
  const pairingRef = useRef<PhonePairing | null>(null);
  const busy = useRef(false);
  /** The relay's clock minus ours, so countdowns and "last seen" don't depend on the phone's clock. */
  const offset = useRef(0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /** Keeps the record: in memory at once, in IndexedDB as soon as it can. */
  const persist = useCallback(async (next: PhonePairing) => {
    pairingRef.current = next;
    setPairing(next);
    setKept(await savePairing(next));
  }, []);

  const forget = useCallback(async (problem?: Problem) => {
    pairingRef.current = null;
    setPairing(null);
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
    setHolds({});
    setOpen(null);
    await clearPairing();
    setScreen({ kind: "none", problem });
  }, []);

  /** One Mac per phone: a new code replaces the old pairing, on the relay too. */
  const replaceWith = useCallback(
    async (fresh: PhonePairing) => {
      const stored = pairingRef.current;
      if (stored?.state === "paired") void phoneRelay(stored).unpair().catch(() => {});
      await forget();
      await persist(fresh);
      setScreen({ kind: "pairing" });
    },
    [persist, forget],
  );

  /**
   * Starts from a pairing link in the fragment, else from what's stored. Runs when the
   * page opens and when a link opens in it while it's already open (a home-screen app).
   */
  const starting = useRef<Promise<void>>(Promise.resolve());
  const startOnce = useCallback(async () => {
    const hash = window.location.hash;
    const stored = pairingRef.current ?? (await loadPairing());
    if (!hash.startsWith("#pair=")) {
      if (!stored) return setScreen({ kind: "none" });
      await persist(stored);
      return setScreen(screenFor(stored));
    }
    // The fragment never reached a server; take it out of the address bar and history too.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    let fresh: PhonePairing;
    try {
      fresh = startPhonePairing(hash, deviceLabel(navigator.userAgent), Date.now());
    } catch {
      if (!stored) return setScreen({ kind: "none", problem: "bad-link" });
      await persist(stored);
      setNotice("That pairing code didn't work. This phone is still paired with your Mac.");
      return setScreen(screenFor(stored));
    }
    const step = pairingLinkStep(stored, fresh);
    if (stored && step !== "start") {
      // The same code opened again carries on with the keys already made for it. A new code
      // while paired waits for your tap: a link alone never unpairs your Mac.
      await persist(stored);
      return setScreen(step === "ask" ? { kind: "replace", fresh } : screenFor(stored));
    }
    await replaceWith(fresh);
  }, [persist, replaceWith]);
  // One start at a time, so a second one sees what the first did (and the fragment gone).
  const begin = useCallback(() => (starting.current = starting.current.then(startOnce).catch(() => {})), [startOnce]);

  useEffect(() => {
    void begin();
    const onHash = () => {
      if (window.location.hash.startsWith("#pair=")) void begin();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [begin]);

  /** One step with the relay: post the hello, or ask for a newer snapshot. */
  const tick = useCallback(async () => {
    const start = pairingRef.current;
    if (!start || busy.current) return;
    busy.current = true;
    try {
      if (start.state === "hello") {
        const tried = helloAttempt(start);
        await persist(tried);
        const next = afterHello(tried, await phoneRelay(tried).hello(tried.hello));
        if ("problem" in next) return void (await forget(next.problem === "taken" ? "taken" : "cancelled"));
        await persist(next.pairing);
        setNet((n) => ({ ...n, unreachable: false }));
        setScreen({ kind: "code" });
        return;
      }
      const poll = await phoneRelay(start).snapshot(start.version);
      if (poll.kind === "gone") return void (await forget(start.state === "paired" ? "unpaired" : "cancelled"));
      if (poll.kind === "waiting") return setNet((n) => ({ ...n, unreachable: false }));
      const { reply } = poll;
      offset.current = reply.now - Date.now();
      const cur = pairingRef.current;
      if (!cur || cur.id !== start.id) return;
      const step = takeSnapshot(cur, reply, Date.now());
      if (step.kind === "unreadable" && cur.state !== "paired") {
        void phoneRelay(cur).unpair().catch(() => {});
        return void (await forget("first-unreadable"));
      }
      if (step.kind === "opened") {
        await persist(step.pairing);
        setScreen((sc) => (sc.kind === "inbox" ? sc : { kind: "inbox" }));
      }
      setNet({ offlineSince: cur.state === "paired" || step.kind === "opened" ? macOfflineSince(reply) : null, unreadable: step.kind === "unreadable", unreachable: false });
    } catch {
      setNet((n) => ({ ...n, unreachable: true }));
    } finally {
      busy.current = false;
    }
  }, [persist, forget]);

  // Ask the relay every 10 s while the page is open and visible, and at once when it becomes visible.
  const polling = screen.kind === "pairing" || screen.kind === "code" || screen.kind === "inbox";
  useEffect(() => {
    if (!polling) return;
    void tick();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void tick();
    }, PHONE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling, tick]);

  // A follow-up's detail is a history entry, so the phone's Back closes it.
  useEffect(() => {
    const onPop = () => setOpen(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openItem = (key: string) => {
    history.pushState({ item: key }, "");
    setOpen(key);
    window.scrollTo(0, 0);
  };
  const closeItem = () => {
    if (history.state?.item) history.back();
    else setOpen(null);
  };

  /** Taps go out one at a time, so they reach the relay in counter order. */
  const queue = useRef(inOrder());
  /** Seals and posts one tap; the record with the new counter is saved first. */
  const send = useCallback(
    (item: PendingItem, kind: "approve" | "dismiss" | "undo-autopilot") =>
      queue.current(async () => {
        const cur = pairingRef.current;
        if (!cur) return;
        const key = itemKey(item);
        const tap = phoneAction(cur, kind, item, Date.now() + offset.current);
        await persist(tap.pairing);
        setTapErrors(({ [key]: _, ...rest }) => rest);
        const failed = async (message: string) => {
          if (pairingRef.current) await persist(forgetTap(pairingRef.current, tap.n));
          setTapErrors((e) => ({ ...e, [key]: message }));
        };
        try {
          const r = await phoneRelay(tap.pairing).action(tap.box);
          if (r.kind === "gone") await forget("unpaired");
          else if (r.kind === "full") await failed("Your Mac has 50 taps waiting. Open Aftercall on your Mac, then try again.");
        } catch {
          await failed("Couldn't reach Aftercall's relay. Check your connection and try again.");
        }
      }),
    [persist, forget],
  );

  /** Approve and Dismiss wait 5 s with Undo, the app's own window, then send. */
  const hold = (item: PendingItem, kind: "approve" | "dismiss") => {
    const key = itemKey(item);
    clearTimeout(timers.current[key]);
    setHolds((h) => ({ ...h, [key]: { kind, until: Date.now() + PHONE_UNDO_MS, item } }));
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      setHolds(({ [key]: _, ...rest }) => rest);
      void send(item, kind);
    }, PHONE_UNDO_MS);
  };
  const undoHold = (key: string) => {
    clearTimeout(timers.current[key]);
    delete timers.current[key];
    setHolds(({ [key]: _, ...rest }) => rest);
  };

  const [unpairing, setUnpairing] = useState<"ask" | "busy" | "failed" | null>(null);
  const unpair = async (localOnly = false) => {
    const cur = pairingRef.current;
    if (!cur) return;
    if (!localOnly) {
      setUnpairing("busy");
      try {
        await phoneRelay(cur).unpair();
      } catch {
        return setUnpairing("failed");
      }
    }
    setUnpairing(null);
    await forget();
  };

  const snapshot = pairing?.snapshot;
  const countingDown = !!snapshot?.items.some((i) => i.autopilotAt);
  const now = useNow(screen.kind === "inbox" && (countingDown || Object.keys(holds).length > 0));
  const relayNow = now + offset.current;

  if (screen.kind === "loading") return <Shell />;

  if (screen.kind === "none") {
    const problem = screen.problem ? PROBLEMS[screen.problem] : null;
    return (
      <Shell>
        <section className={`${p.hero} enter`} aria-labelledby="ph">
          {problem ? (
            <>
              <h1 id="ph" className="t-heading">
                {problem.title}
              </h1>
              <p className="ink-2">{problem.body}</p>
            </>
          ) : (
            <>
              <h1 id="ph" className="t-display">
                Say yes from your phone
              </h1>
              <p className={`${p.lede} ink-2`}>Approve the recap and the payment your meeting agreed, away from your desk. Your Mac still does the sending and paying.</p>
            </>
          )}
        </section>
        <ol className={`${p.steps} enter`} style={{ ["--d" as string]: "60ms" }}>
          <li>
            <span className={p.stepNo}>1</span>
            <span>
              On your Mac, open Aftercall, then <strong>Settings → Phone → Pair a phone</strong>.
            </span>
          </li>
          <li>
            <span className={p.stepNo}>2</span>
            <span>Scan the code with this phone&apos;s camera. It opens this page.</span>
          </li>
          <li>
            <span className={p.stepNo}>3</span>
            <span>Check both screens show the same six digits, then press They match on your Mac.</span>
          </li>
        </ol>
        <Privacy />
      </Shell>
    );
  }

  if (screen.kind === "replace") {
    return (
      <Shell>
        <section className={`${p.hero} enter`} aria-labelledby="rh">
          <h1 id="rh" className="t-heading">
            Pair with a different Mac?
          </h1>
          <p className="ink-2">This phone is paired with your Mac now. Pairing with this new code unpairs it. Go on only if you just made this code on your own Mac.</p>
        </section>
        <div className={p.actions}>
          <button type="button" className="btn btn-secondary btn-lg press" onClick={() => pairing && setScreen(screenFor(pairing))}>
            Keep this pairing
          </button>
          <button type="button" className="btn btn-primary btn-lg press" onClick={() => void replaceWith(screen.fresh)}>
            Pair again
          </button>
        </div>
      </Shell>
    );
  }

  if (screen.kind === "pairing" || screen.kind === "code") {
    return (
      <Shell>
        {!kept && <KeptBanner />}
        {screen.kind === "pairing" || !pairing ? (
          <section className={`${p.hero} enter`} aria-live="polite">
            <h1 className="t-heading">Pairing with your Mac…</h1>
            <p className={p.waiting}>
              <span className="spinner" aria-hidden="true" />
              {net.unreachable ? "Can't reach Aftercall's relay. Trying again…" : "Sending this phone's key, sealed to your Mac."}
            </p>
          </section>
        ) : (
          <section className={`${p.hero} enter`} aria-labelledby="ch">
            <h1 id="ch" className="t-heading">
              Check the code
            </h1>
            <p className={`${p.code} mono`} aria-label={`Code ${pairing.code.split("").join(" ")}`}>
              {groupCode(pairing.code)}
            </p>
            <p className="ink-2">Check your Mac shows the same code, then press They match there.</p>
            <p className={p.waiting} aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {net.unreachable ? "Can't reach Aftercall's relay. Trying again…" : "Waiting for your Mac…"}
            </p>
            <p className="ink-2" style={{ fontSize: 13 }}>
              A different code on your Mac means someone else&apos;s phone answered. Press Cancel there.{" "}
              <button type="button" className="link-button" onClick={() => void forget()}>
                Start over
              </button>
            </p>
          </section>
        )}
      </Shell>
    );
  }

  if (!pairing || !snapshot) return <Shell />;

  const banners = (
    <>
      {notice && (
        <Banner tone="muted" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {!kept && <KeptBanner />}
      {net.offlineSince !== null && (
        <Banner tone="caution" icon="laptop">
          Your Mac is offline (last seen {seenText(net.offlineSince - offset.current, now)}). It will do what you tap here when Aftercall is open again.
        </Banner>
      )}
      {net.unreachable && (
        <Banner tone="caution" icon="refresh">
          Can&apos;t reach Aftercall&apos;s relay. Showing what your Mac sent last.
        </Banner>
      )}
      {net.unreadable && (
        <Banner tone="caution" icon="lock">
          Couldn&apos;t read an update from your Mac. Showing the last one that opened.
        </Banner>
      )}
    </>
  );

  const openNow = open ? snapshot.items.find((i) => itemKey(i) === open) : undefined;
  if (open) {
    return (
      <Shell network={snapshot.network}>
        {banners}
        <button type="button" onClick={closeItem} className={`${p.back} press`}>
          <Icon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
          Needs you
        </button>
        {openNow ? (
          <Detail
            item={openNow}
            snapshot={snapshot}
            pairing={pairing}
            hold={holds[open]}
            tapError={tapErrors[open]}
            offline={net.offlineSince !== null}
            relayNow={relayNow}
            now={now}
            onHold={(kind) => hold(openNow, kind)}
            onUndoHold={() => undoHold(open)}
            onUndoAutopilot={() => void send(openNow, "undo-autopilot")}
          />
        ) : (
          <Gone pairing={pairing} itemKey={open} />
        )}
      </Shell>
    );
  }

  const items = snapshot.items;
  return (
    <Shell network={snapshot.network}>
      {banners}
      <section aria-labelledby="nh" className={p.section}>
        <h1 id="nh" className="t-section">
          Needs you <span className="count">{items.length + snapshot.more}</span>
        </h1>
        {items.length === 0 ? (
          <div className={`${p.empty} enter`}>
            <Tick size={28} still decorative />
            <span>
              <strong>Nothing needs you.</strong>
              <span className="ink-2"> New follow-ups from your meetings show up here while this page is open.</span>
            </span>
          </div>
        ) : (
          <ul className={p.list}>
            {items.map((item, i) => {
              const key = itemKey(item);
              return (
                <Row
                  key={key}
                  index={i}
                  item={item}
                  pairing={pairing}
                  hold={holds[key]}
                  tapError={tapErrors[key]}
                  offline={net.offlineSince !== null}
                  relayNow={relayNow}
                  now={now}
                  onOpen={() => openItem(key)}
                  onUndoHold={() => undoHold(key)}
                  onUndoAutopilot={() => void send(item, "undo-autopilot")}
                />
              );
            })}
          </ul>
        )}
        {snapshot.more > 0 && <p className="ink-2">And {snapshot.more} more on your Mac.</p>}
      </section>

      {snapshot.done.length > 0 && (
        <section aria-labelledby="dh" className={p.section}>
          <h2 id="dh" className="t-section">
            Done today
          </h2>
          <ul className={p.doneList}>
            {snapshot.done.map((d, i) => (
              <li key={`${d.label}-${i}`}>
                <Tick size={18} still decorative />
                <span className={p.doneText}>
                  <span>{d.label}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {[d.doneAt, d.meetingTitle, d.byAutopilot ? "by autopilot" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={p.foot} aria-label="This phone">
        <span className="ink-2" style={{ fontSize: 13 }}>
          Paired with your Mac{pairing.pairedAt ? ` since ${shortDate(pairing.pairedAt)}` : ""}. Updated {clockTime(snapshot.at)}. This page checks for news every 10 seconds while it&apos;s open; there are no notifications yet.
        </span>
        {unpairing === null ? (
          <button type="button" className="btn btn-secondary press" onClick={() => setUnpairing("ask")}>
            Unpair this phone
          </button>
        ) : (
          <div className={p.unpair} role="group" aria-label="Unpair">
            <span>
              {unpairing === "failed"
                ? "Couldn't reach Aftercall's relay, so your Mac still thinks this phone is paired. Try again, or unpair it on your Mac."
                : "Unpair? This phone forgets its keys, and your Mac stops sending it updates."}
            </span>
            <span className={p.unpairButtons}>
              <button type="button" className="btn btn-ghost press" onClick={() => setUnpairing(null)} disabled={unpairing === "busy"}>
                Keep
              </button>
              {unpairing === "failed" && (
                <button type="button" className="btn btn-ghost press" onClick={() => void unpair(true)}>
                  Forget here only
                </button>
              )}
              <button type="button" className="btn btn-primary press" onClick={() => void unpair()} disabled={unpairing === "busy"} aria-busy={unpairing === "busy" || undefined}>
                {unpairing === "busy" ? <span className="spinner spinner-on-accent" aria-hidden="true" /> : null}
                {unpairing === "failed" ? "Try again" : "Unpair"}
              </button>
            </span>
          </div>
        )}
      </section>
      <Privacy />
    </Shell>
  );
}

const screenFor = (p: PhonePairing): Screen => (p.state === "paired" ? { kind: "inbox" } : p.state === "confirming" ? { kind: "code" } : { kind: "pairing" });

/** Re-renders every second while something counts down. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}

/** "14:02" today, "6 Nov 14:02" before. */
function seenText(ms: number, now: number): string {
  return startOfDay(ms) === startOfDay(now) ? clockTime(ms) : `${shortDate(ms, now)} ${clockTime(ms)}`;
}

function Shell({ network, children }: { network?: Snapshot["network"]; children?: ReactNode }) {
  return (
    <>
      <header className={p.header}>
        <div className={p.headerInner}>
          <span className={p.brand}>
            <Logo size={24} />
            <span className={p.brandName}>Aftercall</span>
          </span>
          {network && <span className={p.tag}>{network}</span>}
        </div>
      </header>
      <main className={p.main}>{children}</main>
    </>
  );
}

function Banner({ tone, icon, onClose, children }: { tone: "caution" | "muted"; icon?: "laptop" | "refresh" | "lock"; onClose?: () => void; children: ReactNode }) {
  return (
    <div role="status" className={`${p.banner} ${tone === "caution" ? p.bannerCaution : ""} enter`}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
      {onClose && (
        <button type="button" className={`${p.bannerClose} press`} onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

function KeptBanner() {
  return <Banner tone="caution">This browser isn&apos;t keeping the pairing, so it will be forgotten when you close this page. A private window does this.</Banner>;
}

function Privacy() {
  return (
    <p className={p.privacy}>
      <Icon name="lock" size={14} />
      <span>
        What waits for you travels sealed between your Mac and this phone. Aftercall&apos;s relay passes the sealed boxes on and can&apos;t read them. This phone never sees a summary, a transcript or your notes, and never holds the app&apos;s NEAR key.
      </span>
    </p>
  );
}

interface CardProps {
  item: PendingItem;
  pairing: PhonePairing;
  hold?: Hold;
  tapError?: string;
  offline: boolean;
  relayNow: number;
  now: number;
  onUndoHold: () => void;
  onUndoAutopilot: () => void;
}

const person = (i: PendingItem) => (i.kind === "payment" ? i.payeeName : i.toName || i.to || "Recap");

/** The line under an item that says where it stands: a tap, a hold, autopilot, or why it waits. */
function StatusLine({ item, pairing, hold, tapError, offline, relayNow, now, onUndoHold, onUndoAutopilot, detail }: CardProps & { detail?: boolean }) {
  const choices = phoneChoices(item);
  const tap = tapState(pairing, item);
  if (hold) {
    return (
      <span className={p.statusRow}>
        <span role="status" className="ink">
          {hold.kind === "approve" ? "Approving" : "Dismissing"} in {countdownText(hold.until - now)}
        </span>
        <button type="button" className={`${p.inlineButton} press`} onClick={onUndoHold}>
          Undo
        </button>
      </span>
    );
  }
  if (tapError) return <span className={p.caution}>{tapError}</span>;
  if (tap && tapHolds(tap, item)) return <span className="ink-2">{tapText(tap, offline)}</span>;
  if (choices.undoAutopilot && item.autopilotAt) {
    const left = item.autopilotAt - relayNow;
    const verb = item.kind === "email" ? "sends" : "pays";
    return (
      <span className={p.statusRow}>
        <span role="timer" className="ink">
          {left > 0 ? `Autopilot ${verb} in ${countdownText(left)}` : `Autopilot ${verb} it now`}
        </span>
        {left > 0 && (
          <button type="button" className={`${p.inlineButton} press`} onClick={onUndoAutopilot}>
            Undo
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      {/* An approve or dismiss the Mac ran says nothing here: the item's own state (failed, held) has moved on since. */}
      {tap?.result && (tap.result.outcome === "refused" || tap.sent.kind === "undo-autopilot") && (
        <span className={tap.result.outcome === "refused" ? p.caution : "ink-2"}>{tapText(tap, offline)}</span>
      )}
      {item.error && <span className={p.record}>{item.error}</span>}
      {choices.wallet ? (
        <span className={p.caution}>{detail ? choices.why : "Held for your wallet"}</span>
      ) : choices.why ? (
        <span className={item.status === "sending" ? "ink-2" : p.caution}>{choices.why}</span>
      ) : item.autopilotHeld ? (
        <span className="ink-2">Autopilot held this for your approval.</span>
      ) : item.kind === "payment" ? (
        <span className="ink-2">{routeText(item)}</span>
      ) : (
        <span className="ink-2 mono" style={{ fontSize: 13 }}>
          {item.to}
        </span>
      )}
    </>
  );
}

function Row(props: CardProps & { index: number; onOpen: () => void }) {
  const { item, index, onOpen, now } = props;
  const amount = itemAmount(item);
  return (
    <li className={`${p.row} enter`} style={{ ["--d" as string]: `${Math.min(index, 6) * 40}ms` }}>
      <button type="button" className={`${p.rowMain} press`} onClick={onOpen} aria-label={`${itemTitle(item)}${amount ? `, ${amount}` : ""}. Open`}>
        <Avatar name={person(item)} size={36} decorative />
        <span className={p.rowText}>
          <span className={p.rowTop}>
            <span className={p.rowTitle}>{itemTitle(item)}</span>
            {amount && <span className={`${p.rowAmount} mono`}>{amount}</span>}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {item.sample ? "Sample · " : ""}
            {item.meetingTitle} · {meetingLabel({ id: item.meetingId, startedAt: item.meetingAt }, now)}
          </span>
        </span>
        <Icon name="chevronRight" size={16} className={p.rowChevron} />
      </button>
      <span className={p.rowStatus}>
        <StatusLine {...props} />
      </span>
    </li>
  );
}

function Detail(props: CardProps & { snapshot: Snapshot; onHold: (kind: "approve" | "dismiss") => void }) {
  const { item, snapshot, pairing, hold, onHold, now } = props;
  const choices = phoneChoices(item);
  const tap = tapState(pairing, item);
  const amount = itemAmount(item);
  const canTap = !hold && !tapHolds(tap, item);

  return (
    <article className={p.detail} aria-labelledby="dt">
      <header className={`${p.detailHead} enter`}>
        <span className={p.pills}>
          {item.sample && <Pill tone="muted">Sample</Pill>}
          {item.status === "blocked" && <Pill tone="caution">Over your caps</Pill>}
          {item.status === "failed" && <Pill tone="record">Failed</Pill>}
          {item.status === "sending" && <Pill tone="verdigris">{item.kind === "email" ? "Sending" : "Paying"}</Pill>}
        </span>
        <h1 id="dt" className="t-heading">
          {item.status === "blocked" ? "Held for your wallet" : itemTitle(item)}
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {item.meetingTitle} · {meetingLabel({ id: item.meetingId, startedAt: item.meetingAt }, now)}
        </span>
      </header>

      <dl className={`${p.facts} enter`} style={{ ["--d" as string]: "40ms" }}>
        {item.kind === "payment" ? (
          <>
            <div className={p.amount}>
              <dt className="sr-only">Amount</dt>
              <dd>{amount ? <span className="mono">{amount.replace(/ USDC$/, "")}</span> : <span className={p.caution}>Amount unclear</span>}{amount && <span className="mono ink-2">USDC</span>}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd className={p.person}>
                <Avatar name={item.payeeName} size={28} decorative />
                <span style={{ fontWeight: 600 }}>{item.payeeName}</span>
                {item.payeeAccount ? (
                  <span className="mono ink-2" style={{ fontSize: 13 }}>
                    {item.payeeAccount}
                  </span>
                ) : (
                  <span className={p.caution}>Not on your list</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Route</dt>
              <dd>
                {routeText(item)}
                {item.route && (
                  <span className="mono muted" style={{ display: "block", fontSize: 12, overflowWrap: "anywhere" }}>
                    {item.route.address}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Heard</dt>
              <dd className={p.heard}>“{item.heard}”</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>To</dt>
              <dd className={p.person}>
                <Avatar name={person(item)} size={28} decorative />
                {item.toName && <span style={{ fontWeight: 600 }}>{item.toName}</span>}
                {item.to ? (
                  <span className="mono ink-2" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                    {item.to}
                  </span>
                ) : (
                  <span className={p.caution}>No address yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{item.subject}</dd>
            </div>
          </>
        )}
      </dl>

      <figure className={`${p.quote} enter`} style={{ ["--d" as string]: "80ms" }}>
        <blockquote>“{item.quote}”</blockquote>
        <figcaption className="muted">From the meeting, word for word</figcaption>
      </figure>

      <section className={`${p.leaves} enter`} style={{ ["--d" as string]: "120ms" }} aria-labelledby="wl">
        <h2 id="wl" className={p.leavesTitle}>
          What leaves
        </h2>
        <p>{item.whatLeaves.summary}</p>
        {item.whatLeaves.details.length > 0 && (
          <ul>
            {item.whatLeaves.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </section>

      {item.sample && <p className="ink-2">From the made-up sample meeting: approving it is simulated, as in the app.</p>}

      {!hold && (
        <div className={p.statusBlock}>
          <StatusLine {...props} detail />
        </div>
      )}

      {choices.wallet ? (
        <WalletActions item={item} snapshot={snapshot} />
      ) : hold ? (
        // The 5 s hold stays where the buttons were, in reach of the thumb.
        <div className={`${p.actions} ${p.holdBar}`}>
          <span role="status">
            {hold.kind === "approve" ? "Approving" : "Dismissing"} in {countdownText(hold.until - now)}
          </span>
          <button type="button" className="btn btn-secondary btn-lg press" onClick={props.onUndoHold}>
            Undo
          </button>
        </div>
      ) : (
        canTap &&
        (choices.approve || choices.dismiss) && (
          <div className={p.actions}>
            {choices.dismiss && (
              <button type="button" className="btn btn-secondary btn-lg press" onClick={() => onHold("dismiss")}>
                Dismiss
              </button>
            )}
            {choices.approve && (
              <button type="button" className="btn btn-primary btn-lg press" onClick={() => onHold("approve")}>
                {choices.approveLabel}
              </button>
            )}
          </div>
        )
      )}
    </article>
  );
}

/** An open follow-up that left the inbox: what this phone's tap did, if it was the reason. */
function Gone({ pairing, itemKey: key }: { pairing: PhonePairing; itemKey: string }) {
  const [meetingId, followUpId] = key.split("/");
  const tap = tapState(pairing, { meetingId, followUpId });
  const done = tap?.result?.outcome === "accepted" && tap.sent.kind !== "undo-autopilot";
  return (
    <div className={`${p.empty} enter`}>
      {done && <Tick size={28} decorative />}
      <span className="ink-2">
        {done
          ? tap.sent.kind === "approve"
            ? "Your Mac did it. It shows under Done today."
            : "Dismissed on your Mac."
          : "This follow-up isn't waiting any more. Your Mac sent it, or it was dismissed there."}
      </span>
    </div>
  );
}

/** A held payment opens the web /sign page in your NEAR wallet, only when its links are for exactly this payment. */
function WalletActions({ item, snapshot }: { item: PendingItem; snapshot: Snapshot }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  if (item.kind !== "payment" || origin === null) return null;
  if (!item.signUrls || !signUrlsMatch(item, origin, snapshot.network)) {
    return <p className={p.caution}>Review this on your Mac.</p>;
  }
  return (
    <div className={p.actions}>
      <a href={item.signUrls.decline} target="_blank" rel="noreferrer" className="btn btn-secondary btn-lg press">
        Decline
      </a>
      <a href={item.signUrls.approve} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg press">
        Approve in wallet
      </a>
    </div>
  );
}
