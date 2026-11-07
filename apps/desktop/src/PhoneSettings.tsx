import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Check, Smartphone } from "lucide-react";
import { encode } from "uqr";
import { clockTime, longDate } from "@aftercall/core";
import { cancelPairing, confirmPairing, loadPhone, pairingProblem, startPairing, unpair, usePhone, waitForHello, type PendingPairing, type PhoneHello } from "./phone";
import { CheckCircle } from "./primitives/Check";
import { CardRow, IconDisc, Pop, Why } from "./SettingsParts";
import { Button, Card, Dialog, Pill, SectionTitle, Spinner, toast, useConfirm } from "./ui";

/**
 * "Your phone" in Settings: pair a phone with a QR code and a 6-digit code to compare,
 * see which phone is paired, and unpair it (docs/design/phone-protocol.md). Settings
 * shows it only in a build with a backend, which carries the relay (`CAN_PAIR`).
 */
export function PhoneSettings() {
  const phone = usePhone();
  const [pairing, setPairing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const confirm = useConfirm();
  const paired = phone.paired;
  const name = paired?.device || "your phone";
  useEffect(() => void loadPhone(), []);

  const remove = async () => {
    const ok = await confirm({
      title: `Unpair ${name}?`,
      body: "It stops showing what waits for you, and your Mac refuses anything it sends from now on. Pair it again any time.",
      confirmLabel: "Unpair",
      tone: "danger",
    });
    if (!ok) return;
    setLeaving(true);
    const reached = await unpair().catch(() => false);
    setLeaving(false);
    toast(
      reached
        ? { text: `Unpaired ${name}`, tone: "verdigris" }
        : { text: "Unpaired on this Mac. The relay couldn't be reached; it forgets the pairing 30 days after it last hears from this Mac.", tone: "caution" },
    );
  };

  return (
    <section aria-labelledby="h-phone" className="flex flex-col gap-3">
      <SectionTitle id="h-phone" count="optional">
        Your phone
      </SectionTitle>
      <Card pad="none">
        <CardRow
          icon={
            <IconDisc tone={paired ? "verdigris" : "well"}>
              <Smartphone size={16} strokeWidth={1.75} />
            </IconDisc>
          }
          title={paired ? `Paired with ${name}` : "No phone paired"}
          detail={
            paired
              ? `Since ${longDate(paired.pairedAt)}. What waits for you shows there; this Mac does what you approve.`
              : "Approve or dismiss recaps and payments from your phone. This Mac still does every send and payment."
          }
        >
          <Pop show={Boolean(paired)}>
            <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
              Paired
            </Pill>
          </Pop>
          {!phone.loaded ? (
            <Spinner size={14} label="Checking for a paired phone" />
          ) : paired ? (
            <Button variant="quiet" loading={leaving} onClick={remove}>
              Unpair
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setPairing(true)}>
              Pair a phone
            </Button>
          )}
        </CardRow>
      </Card>
      {paired && phone.problem && <p className="m-0 text-[13px] leading-[19px] text-caution">Your phone can't hear from this Mac right now: {phone.problem}</p>}
      <Why>
        Your phone sees each waiting recap's address and subject, each payment's payee, amount and the words it was heard as, the quote from the call behind it, and
        the meeting's title and time. Never the summary, the transcript or your notes, and never this Mac's NEAR key, your rules or your payee list. Aftercall's
        backend passes sealed boxes between the two that it can't read. This Mac checks every tap again before it runs it, under the same rules and caps; a
        payment over a cap opens your NEAR wallet on the phone, so its link also carries your NEAR account and what's left of today's cap.
      </Why>
      <AnimatePresence>{pairing && <PairSheet key="pair" onClose={() => setPairing(false)} />}</AnimatePresence>
    </section>
  );
}

type Step =
  | { name: "starting" }
  | { name: "qr"; p: PendingPairing }
  | { name: "code"; p: PendingPairing; hello: PhoneHello; confirming?: boolean }
  | { name: "paired"; device: string }
  | { name: "expired" }
  | { name: "failed"; error: string };

/** "418207" → "418 207", as both screens show it. */
const grouped = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * The pairing sheet: the QR code, then the code to compare, then Paired. Cancel, or
 * closing the sheet before They match, deletes the pairing on the relay.
 */
function PairSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ name: "starting" });
  const [attempt, setAttempt] = useState(0);
  /** The pairing to delete if you leave before They match. */
  const open = useRef<PendingPairing | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    let live = true;
    const drop = () => {
      if (open.current) cancelPairing(open.current);
      open.current = null;
    };
    (async () => {
      try {
        const p = await startPairing();
        if (!live) return cancelPairing(p);
        open.current = p;
        setStep({ name: "qr", p });
        const hello = await waitForHello(p, stop.signal);
        if (!live) return;
        if (!hello) {
          drop();
          setStep({ name: "expired" });
          return;
        }
        setStep({ name: "code", p, hello });
      } catch (e) {
        if (!live) return;
        drop();
        setStep({ name: "failed", error: pairingProblem(e) });
      }
    })();
    return () => {
      live = false;
      stop.abort();
    };
  }, [attempt]);

  const close = () => {
    if (open.current) cancelPairing(open.current);
    open.current = null;
    onClose();
  };

  const match = async (p: PendingPairing, hello: PhoneHello) => {
    setStep({ name: "code", p, hello, confirming: true });
    try {
      await confirmPairing(p, hello);
      open.current = null;
      setStep({ name: "paired", device: hello.device || "your phone" });
    } catch (e) {
      if (open.current) cancelPairing(open.current);
      open.current = null;
      setStep({ name: "failed", error: pairingProblem(e) });
    }
  };

  const again = () => {
    setStep({ name: "starting" });
    setAttempt((n) => n + 1);
  };

  const intro =
    step.name === "code"
      ? "Check both screens show the same code. If they don't, someone else may have scanned it: cancel."
      : step.name === "paired"
        ? "What waits for you now shows on your phone."
        : "Scan the code with your phone's camera. It opens Aftercall's phone page, which you can add to your home screen.";

  return (
    <Dialog title="Pair a phone" intro={intro} onClose={close} width={480} dismissible={step.name !== "code" || !step.confirming}>
      <div className="flex flex-col items-center gap-5 pt-1" style={{ animation: "ac-in 240ms var(--ease) both" }}>
        {step.name === "starting" && (
          <div className="flex h-[264px] items-center">
            <Spinner size={18} label="Making a pairing code" />
          </div>
        )}
        {step.name === "qr" && (
          <>
            <QrCode text={step.p.url} label="Pairing code for your phone's camera" />
            <p className="m-0 text-center text-[13px] leading-[19px] text-ink-2" role="status">
              Waiting for your phone. This code works until {clockTime(step.p.expiresAt)}.
            </p>
          </>
        )}
        {step.name === "code" && (
          <div className="flex flex-col items-center gap-2 py-6">
            <span className="text-[13px] leading-[19px] text-ink-2">Does {step.hello.device || "your phone"} show this code?</span>
            <span className="t-figure-xl selectable text-ink" aria-label={step.hello.session.code.split("").join(" ")}>
              {grouped(step.hello.session.code)}
            </span>
          </div>
        )}
        {step.name === "paired" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={40} play />
            <span className="t-title text-ink">Paired with {step.device}</span>
          </div>
        )}
        {step.name === "expired" && <p className="m-0 py-10 text-center text-ink-2">The code ran out before a phone used it. Make a new one.</p>}
        {step.name === "failed" && <p className="selectable m-0 py-10 text-center break-words text-record">{step.error}</p>}

        <div className="flex w-full justify-end gap-2">
          {step.name === "code" ? (
            <>
              <Button variant="ghost" disabled={step.confirming} onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" loading={step.confirming} onClick={() => match(step.p, step.hello)}>
                They match
              </Button>
            </>
          ) : step.name === "paired" ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : step.name === "expired" || step.name === "failed" ? (
            <>
              <Button variant="ghost" onClick={close}>
                Close
              </Button>
              <Button variant="primary" onClick={again}>
                New code
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The pairing URL as a QR code, drawn as one SVG path. Dark modules on the light theme's
 * paper in both themes, as a camera reads best.
 */
function QrCode({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => encode(text, { ecc: "M", border: 2 }), [text]);
  const d = qr.data.map((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")).join("")).join("");
  return (
    <div data-theme="light" className="rounded-md bg-raised p-2 text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
      <svg role="img" aria-label={label} viewBox={`0 0 ${qr.size} ${qr.size}`} width={248} height={248} shapeRendering="crispEdges">
        <path d={d} fill="currentColor" />
      </svg>
    </div>
  );
}
