import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { near, setupCommands, type NearConfig, type NearStatus } from "./near";
import { Button, Pill, SectionLabel, Spinner, cx } from "./ui";

/**
 * Connects the user's NEAR account. The app holds its own limited key; the user
 * authorises it once from their own wallet or near-cli, so the app can only
 * record proofs and pay within the contract's caps.
 */
export function ConnectNear() {
  const [config, setConfig] = useState<NearConfig>({ network: "testnet", account: "", contract: "" });
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<NearStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    near.getConfig().then((c) => c && setConfig(c));
    near.publicKey().then(setPublicKey).catch((e) => setError(String(e)));
  }, []);

  const ready = config.account.length > 1 && config.contract.length > 1;
  const commands = ready && publicKey ? setupCommands(config, publicKey) : null;

  const check = async () => {
    setError(null);
    setChecking(true);
    try {
      await near.saveConfig(config);
      setStatus(await near.status());
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1600);
  };

  const connected = status?.registered && status.keyAdded;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <span className="t-label text-muted">Settings · NEAR</span>
            {connected && <Pill tone="verdigris">Connected</Pill>}
          </div>
          <h1 className="t-display m-0">Connect NEAR</h1>
          <p className="t-reading m-0 text-muted">
            Aftercall records each meeting's proof on NEAR, and later pays from your agent wallet, with a key that can do nothing else.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <SectionLabel>Your account</SectionLabel>
          <Field label="NEAR account" value={config.account} placeholder="yourname.testnet" onChange={(account) => setConfig({ ...config, account: account.trim().toLowerCase() })} />
          <Field label="Agent-wallet contract" value={config.contract} placeholder="aftercall-wallet.testnet" onChange={(contract) => setConfig({ ...config, contract: contract.trim().toLowerCase() })} />
          <div className="flex items-center justify-between">
            <span className="text-muted">Network</span>
            <select
              value={config.network}
              onChange={(e) => setConfig({ ...config, network: e.target.value as NearConfig["network"] })}
              className="h-8 rounded-sm border border-border bg-well px-2.5 text-ink"
            >
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Authorise this Mac, once</SectionLabel>
          <p className="m-0 text-muted">
            Run these with near-cli from your own account. The first creates your agent wallet; the second lets this Mac's key call only{" "}
            <span className="t-mono text-ink">pay</span> and <span className="t-mono text-ink">record_proof</span>. Any rule change still needs your wallet.
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-muted">This Mac's key</span>
            <span className="t-mono selectable break-all rounded-sm bg-well px-3 py-2">{publicKey || "…"}</span>
          </div>
          {commands ? (
            <>
              <Command n={1} text={commands.register} done={status?.registered} copied={copied === "register"} onCopy={() => copy("register", commands.register)} />
              <Command n={2} text={commands.addKey} done={status?.keyAdded} copied={copied === "addKey"} onCopy={() => copy("addKey", commands.addKey)} />
            </>
          ) : (
            <p className="m-0 text-caution">Enter your account and the contract to see the commands.</p>
          )}
        </section>

        <div className="flex flex-col gap-2">
          {status?.keyProblem && <p className="m-0 text-caution">{status.keyProblem}</p>}
          {error && <p className="selectable m-0 break-words text-record">{error}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={check} disabled={!ready || checking}>
              {checking && <Spinner size={12} />}
              Save and check
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="selectable h-8 w-[300px] rounded-sm border border-border bg-well px-2.5 font-mono text-xs text-ink outline-none placeholder:text-muted"
      />
    </label>
  );
}

function Command({ n, text, done, copied, onCopy }: { n: number; text: string; done?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div className={cx("flex flex-col gap-2 rounded-md p-4 shadow-[inset_0_0_0_1px_var(--hairline)]", done && "bg-verdigris-tint/40")}>
      <div className="flex items-center justify-between">
        <span className="t-title">
          {n === 1 ? "Create your agent wallet" : "Authorise this Mac's key"}
          {done && <Check size={14} strokeWidth={2} className="ml-2 inline text-verdigris" aria-label="Done" />}
        </span>
        <button onClick={onCopy} className="inline-flex items-center gap-1.5 text-xs font-semibold text-verdigris hover:text-verdigris-hover">
          <Copy size={12} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="t-mono selectable block break-all text-muted">{text}</code>
    </div>
  );
}
