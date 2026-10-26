import { useState } from "react";
import type { AutopilotRules } from "@aftercall/core";
import { loadRules, saveRules } from "./autopilot";
import { SectionLabel } from "./ui";

/** Autopilot: what may happen without a tap. The contract's caps still apply on chain. */
export function AutopilotSettings() {
  const [rules, setRules] = useState<AutopilotRules>(loadRules);
  const [domains, setDomains] = useState(rules.recapDomains.join(", "));

  const update = (next: AutopilotRules) => {
    setRules(next);
    saveRules(next);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Autopilot</SectionLabel>
      <p className="m-0 text-muted">
        Follow-ups that pass every rule run by themselves after a {60}-second undo window. Anything unclear still waits for you, and your agent wallet's caps apply on NEAR either way.
      </p>
      <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
        <label className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <input type="checkbox" checked={rules.payments} onChange={(e) => update({ ...rules, payments: e.target.checked })} className="mt-0.5 size-[15px]" />
          <span className="flex flex-col gap-0.5">
            <span className="t-title">Pay listed payees</span>
            <span className="text-muted">Only people on your payee list, only up to your per-payment limit (set it in Agent wallet), and only when the heard amount is clear.</span>
          </span>
        </label>
        <div className="flex flex-col gap-2 px-5 py-4">
          <span className="t-title">Send recaps to your team</span>
          <span className="text-muted">Recaps to these email domains go out by themselves. Leave empty to always ask.</span>
          <input
            value={domains}
            onChange={(e) => {
              // Saved as you type, so leaving Settings straight away doesn't lose it.
              setDomains(e.target.value);
              update({ ...rules, recapDomains: e.target.value.split(/[,\s]+/).map((d) => d.trim().replace(/^@/, "")).filter(Boolean) });
            }}
            placeholder="your-company.com"
            className="selectable h-8 rounded-sm border border-border bg-well px-2.5 font-mono text-xs text-ink outline-none placeholder:text-muted"
          />
        </div>
      </div>
    </section>
  );
}
