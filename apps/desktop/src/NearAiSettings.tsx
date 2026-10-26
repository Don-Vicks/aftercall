import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { nearAiKey } from "./nearai";
import { isDesktop } from "./recorder";
import { Button, SectionLabel } from "./ui";

/** The NEAR AI API key: kept in the macOS Keychain, never shown again once saved. */
export function NearAiSettings() {
  const [has, setHas] = useState<boolean | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktop) nearAiKey.has().then(setHas).catch(() => setHas(false));
  }, []);

  const save = async () => {
    setError(null);
    try {
      await nearAiKey.set(key);
      setKey("");
      setReplacing(false);
      setHas(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the NEAR AI key from this Mac? Recordings will wait for notes until you add one again.")) return;
    await nearAiKey.clear();
    setHas(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>NEAR AI</SectionLabel>
      <p className="m-0 text-muted">Your API key from cloud.near.ai. Set a spend limit on it there. It's kept in your macOS Keychain and used only for NEAR AI's private models.</p>
      {has && !replacing ? (
        <div className="flex items-center justify-between rounded-md px-5 py-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <span className="flex items-center gap-2 font-semibold">
            <Check size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" /> Key saved in Keychain
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={remove}>Remove</Button>
            <Button onClick={() => setReplacing(true)}>Replace</Button>
          </span>
        </div>
      ) : (
        <div className="flex gap-2">
          <label htmlFor="settings-nearai-key" className="sr-only">NEAR AI API key</label>
          <input
            id="settings-nearai-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            className="selectable h-8 flex-1 rounded-sm border border-border bg-well px-2.5 text-ink outline-none placeholder:text-muted"
          />
          <Button variant="primary" disabled={key.trim().length < 16 || !isDesktop} onClick={save}>Save key</Button>
          {replacing && <Button variant="ghost" onClick={() => setReplacing(false)}>Cancel</Button>}
        </div>
      )}
      {error && <p className="m-0 text-record">{error}</p>}
    </section>
  );
}
