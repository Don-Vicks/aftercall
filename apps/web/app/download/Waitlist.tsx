"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "../ui";
import d from "./download.module.css";

/** The boxes, in the order the API stores them (app/api/waitlist/route.ts). */
const OPTIONS: [string, string][] = [
  ["intel", "An Intel Mac build"],
  ["windows", "Windows"],
  ["mainnet", "Mainnet and a signed app"],
  ["updates", "Just the news"],
];

/** Joins the waitlist: an email and what they're waiting for. */
export function Waitlist() {
  const [email, setEmail] = useState("");
  const [wants, setWants] = useState<string[]>([]);
  const [company, setCompany] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const toggle = (w: string) => setWants((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, wants, company }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; already?: boolean };
      if (!res.ok) throw new Error(out.error ?? "Something went wrong. Try again.");
      setMessage(out.already ? "You're already on it. We've added what you ticked." : "You're on the list. We'll email you when it's ready.");
      setState("done");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <p className={d.waitDone} role="status">
        <Icon name="check" size={16} stroke={2.4} />
        {message}
      </p>
    );
  }

  return (
    <form className={d.waitForm} onSubmit={submit}>
      <div className={d.waitWants} role="group" aria-labelledby="wait-for">
        <span id="wait-for" className={d.waitLegend}>
          I&apos;m waiting for
        </span>
        {OPTIONS.map(([value, label]) => {
          const on = wants.includes(value);
          return (
            <button key={value} type="button" className={d.waitChip} aria-pressed={on} onClick={() => toggle(value)}>
              {on && <Icon name="check" size={13} stroke={2.6} />}
              {label}
            </button>
          );
        })}
      </div>
      <div className={d.waitRow}>
        <label htmlFor="wait-email" className="sr-only">
          Email
        </label>
        <input
          id="wait-email"
          className="field"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn-primary press" disabled={state === "sending"}>
          {state === "sending" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {/* For bots only: people never see or fill it. */}
      <input
        className={d.waitTrap}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
      />
      {state === "error" && (
        <p className={d.waitError} role="alert">
          {message}
        </p>
      )}
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Only to tell you when what you ticked is ready. Never shared, never sold.
      </p>
    </form>
  );
}
