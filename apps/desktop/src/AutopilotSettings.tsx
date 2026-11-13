import { useEffect, useState } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { UNDO_SECONDS, formatUsdc, type AutopilotRules } from "@aftercall/core";
import { loadRules, saveRules } from "./autopilot";
import { near } from "./near";
import { isDesktop } from "./recorder";
import { HAS_BACKEND } from "./backend";
import { Card, Field, Input, SectionTitle, Toggle, enter, exit } from "./ui";
import { Why, grow } from "./SettingsParts";

const parseDomains = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((d) => d.trim().replace(/^@/, ""))
    .filter(Boolean);

/** Autopilot: what may happen without a tap. The contract's caps still apply on chain. */
export function AutopilotSettings() {
  const [rules, setRules] = useState<AutopilotRules>(loadRules);
  const [domains, setDomains] = useState(rules.recapDomains.join(", "));
  /** The switch for recaps; off saves no domains (always ask), and the typed ones come back when it's on again. */
  const [recapsOn, setRecapsOn] = useState(rules.recapDomains.length > 0);
  /** The contract's per-payment cap, when NEAR is connected. */
  const [cap, setCap] = useState<bigint | null>(null);
  const still = useReducedMotion();

  useEffect(() => {
    if (!isDesktop) return;
    near
      .wallet()
      .then((v) => v.wallet && setCap(BigInt(v.wallet.per_payment_cap)))
      .catch(() => {});
  }, []);

  const update = (next: AutopilotRules) => {
    setRules(next);
    saveRules(next);
  };

  // Payments are never on autopilot: words on a call aren't authorization (anyone near your
  // microphone is "You"), so each one waits for your tap. The contract's caps apply when you tap.
  const payDetail =
    cap === null || cap === 0n ? (
      "Each payment waits for your tap, here or on your phone. The contract's caps still apply when you tap."
    ) : (
      <>
        Each payment waits for your tap, here or on your phone. The contract still pays at most <span className="font-mono">{formatUsdc(cap)} USDC</span> each; more waits for your wallet.
      </>
    );

  return (
    <section aria-labelledby="h-autopilot" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id="h-autopilot" count="without a tap">
          Autopilot
        </SectionTitle>
        <p className="m-0 text-ink-2">Recaps that pass every rule go out by themselves after a {UNDO_SECONDS}-second undo. Payments never do.</p>
      </div>
      <Card pad="none">
        <div className="flex items-center gap-4 border-b border-hairline px-5 py-4">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="t-title">Payments</span>
            <span className="text-[13px] leading-[19px] text-ink-2">{payDetail}</span>
          </span>
          <span className="shrink-0 text-[13px] leading-[19px] text-ink-2">Always ask</span>
        </div>
        <div className="flex flex-col px-5 py-4">
          <div className="flex items-center gap-4">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="t-title">Send recaps to your team</span>
              <span className="text-[13px] leading-[19px] text-ink-2">
                {!HAS_BACKEND
                  ? "Needs Send through Aftercall, which this build doesn't have. Recaps wait for you to draft them in Mail."
                  : recapsOn
                    ? "Recaps to these email domains go out by themselves."
                    : "Off. Every recap waits for you."}
              </span>
            </span>
            <Toggle
              aria-label="Send recaps to your team"
              checked={recapsOn && HAS_BACKEND}
              disabled={!HAS_BACKEND}
              onChange={(on) => {
                setRecapsOn(on);
                update({ ...rules, recapDomains: on ? parseDomains(domains) : [] });
              }}
            />
          </div>
          <AnimatePresence initial={false}>
            {recapsOn && (
              <m.div
                key="domains"
                initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto", transition: still ? enter : grow }}
                exit={still ? { opacity: 0, transition: exit } : { opacity: 0, height: 0, transition: exit }}
                // A pixel of room so the focus ring isn't clipped.
                className="-mx-px overflow-hidden px-px pb-px"
              >
                <Field
                  label="Team domains"
                  hint={rules.recapDomains.length ? undefined : "Add at least one, or every recap still waits for you."}
                  className="pt-3"
                >
                  <Input
                    mono
                    value={domains}
                    onChange={(e) => {
                      // Saved as you type, so leaving Settings straight away doesn't lose it.
                      setDomains(e.target.value);
                      update({ ...rules, recapDomains: parseDomains(e.target.value) });
                    }}
                    placeholder="your-company.com"
                    spellCheck={false}
                  />
                </Field>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
      <Why>Anything unclear still waits for you. Your agent wallet's caps apply on NEAR either way, so autopilot can't pay past them.</Why>
    </section>
  );
}
