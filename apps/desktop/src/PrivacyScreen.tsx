import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowLeftRight, Check, Cpu, ExternalLink, FolderGit2, HardDrive, Info, KeyRound, Link2, Lock, Mail, Server, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { agentsApi, PREVIEW_INFO } from "./agents";
import { isDesktop } from "./recorder";
import { nearAiKey } from "./nearai";
import { loadPhone, usePhone } from "./phone";
import { recovery, restoredSummary, type RecoveryStatus, type Restored } from "./recovery";
import { ImportBackup } from "./RecoveryPhrase";
import { deleteEverything, type Wiped } from "./library";
import { Button, Dialog, Field, Input, Pill, SectionTitle, Spinner } from "./ui";
import { Page, PageHeader, Why, rise } from "./PagePieces";

/** The five Keychain items (service dev.aftercall.app); see src-tauri/src/wipe.rs. */
const KEYCHAIN: { id: "nearai" | "near" | "data" | "backup" | "phone"; name: string; does: string }[] = [
  { id: "nearai", name: "NEAR AI key", does: "makes your notes" },
  { id: "near", name: "This Mac's NEAR key", does: "pays and records proofs, within your caps" },
  { id: "data", name: "Data key", does: "seals your meetings on disk" },
  { id: "backup", name: "Backup key", does: "opens backups, made from your phrase" },
  { id: "phone", name: "Phone keys", does: "seal what your paired phone sees, and open its taps" },
];

/** Every place data goes, from docs/privacy.md. */
const PLACES: { icon: ReactNode; name: string; kind: string; sees: string; keeps: string }[] = [
  {
    icon: <Cpu size={14} strokeWidth={1.75} />,
    name: "NEAR AI",
    kind: "Secure hardware (TEE)",
    sees: "Audio in chunks, with project and payee names and your brief's words to expect for spelling, then the transcript and your project brief, end-to-end encrypted. When you ask your meetings: the question, the few lines that match it and their projects' briefs.",
    keeps: "Set by NEAR AI's policy, not by Aftercall.",
  },
  {
    icon: <Link2 size={14} strokeWidth={1.75} />,
    name: "NEAR blockchain",
    kind: "Public, permanent",
    sees: "Proofs: start time, a hash, the model. Payments: payee, amount, a fixed memo.",
    keeps: "All of it, forever and in public. Never what was said.",
  },
  {
    icon: <Server size={14} strokeWidth={1.75} />,
    name: "Aftercall server",
    kind: "Only if you use it",
    sees: "Recaps you send through Aftercall, for one request. Claim links you make. With a paired phone: sealed boxes it can't open, and when each side calls.",
    keeps: "A send count. Per claim link: token hash, amount, expiry, status, payee account. For a paired phone: token hashes, the latest sealed snapshot, and taps until your Mac collects them (a day at most).",
  },
  {
    icon: <Smartphone size={14} strokeWidth={1.75} />,
    name: "Your paired phone",
    kind: "Only if you pair one",
    sees: "What waits for you: each recap's address and subject, each payment's payee, amount and the words it was heard as, the quote behind it, the meeting's title and time. For a payment held over a cap, your NEAR account and what's left of today's cap, for your wallet. Never the summary, transcript or your notes.",
    keeps: "The latest snapshot, in the phone browser's storage for Aftercall's site, until you unpair.",
  },
  {
    icon: <FolderGit2 size={14} strokeWidth={1.75} />,
    name: "GitHub",
    kind: "Only if you fill a brief from a repo",
    sees: "Which repo you looked up, from this Mac (through gh, with your own GitHub sign-in). Nothing from your meetings.",
    keeps: "Set by GitHub's policy.",
  },
  { icon: <Mail size={14} strokeWidth={1.75} />, name: "Resend", kind: "Recap email", sees: "Recaps you send through Aftercall.", keeps: "Sent mail, under Resend's own policy." },
  {
    icon: <ArrowLeftRight size={14} strokeWidth={1.75} />,
    name: "1Click",
    kind: "Solana and Base payees",
    sees: "Amount, destination address and your NEAR account for refunds.",
    keeps: "Set by 1Click's policy.",
  },
];

/**
 * Privacy and your data, from Settings: where everything lives on this Mac, what
 * leaves it and what each place keeps, backups, and deleting everything.
 */
export function PrivacyScreen({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const [dataDir, setDataDir] = useState<string>(isDesktop ? "" : PREVIEW_INFO.dataDir);
  const [keys, setKeys] = useState<{ nearai: boolean; recovery: RecoveryStatus } | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    agentsApi
      .info()
      .then((i) => setDataDir(i.dataDir))
      .catch(() => setDataDir(PREVIEW_INFO.dataDir));
    void loadPhone();
    Promise.all([nearAiKey.has().catch(() => false), recovery.status()])
      .then(([nearai, r]) => setKeys({ nearai, recovery: r }))
      .catch(() => {});
  }, []);

  const phone = usePhone();
  const missing = (id: (typeof KEYCHAIN)[number]["id"]) =>
    id === "phone"
      ? phone.loaded && !phone.paired
      : !keys
        ? false
        : id === "nearai"
          ? !keys.nearai
          : id === "near"
            ? !keys.recovery.hasKey
            : id === "backup"
              ? !keys.recovery.fromPhrase
              : false;

  return (
    <Page width={840} className="gap-6">
      <PageHeader back={{ label: "Settings", onClick: onBack }} title="Privacy and your data" intro="What stays on this Mac, what leaves it, and what each place keeps." />

      <section aria-labelledby="pv-where" className="flex flex-col gap-3" style={rise(1)}>
        <SectionTitle id="pv-where" count="on this Mac">
          Where your data lives
        </SectionTitle>
        <div className="flex flex-col rounded-md bg-elevated shadow-1">
          <div className="flex flex-wrap items-start gap-3.5 border-b border-hairline px-5 py-4">
            <span aria-hidden="true" className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-well text-ink-2">
              <HardDrive size={16} strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <span className="t-title text-ink">On this Mac, encrypted</span>
              <span className="t-mono selectable text-ink-2 [overflow-wrap:anywhere]">{dataDir || "…"}</span>
              <span className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] leading-[19px] text-ink">
                <Check size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
                Audio is deleted once the notes are saved
              </span>
            </span>
            <Pill tone="verdigris" icon={<Lock size={11} strokeWidth={2.2} />}>
              Encrypted
            </Pill>
            {isDesktop && dataDir && (
              <Button variant="quiet" size="sm" className="-mt-1" onClick={() => revealItemInDir(dataDir).catch(() => {})}>
                Show in Finder
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2.5 px-5 pt-3.5 pb-4">
            <span className="flex items-baseline gap-2">
              <span className="text-[14px] leading-5 font-semibold text-ink">In your macOS Keychain</span>
              <span className="t-eyebrow text-muted">{KEYCHAIN.length} items</span>
            </span>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-0">
              {KEYCHAIN.map((k) => (
                <li key={k.id} className="flex min-w-0 items-center gap-2.5">
                  <KeyRound size={14} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-ink">{k.name}</span> <span className="text-[13px] text-ink-2">{k.does}</span>
                    {missing(k.id) && <span className="text-[13px] text-muted"> · not set yet</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Why>
          Audio is sealed about once a second while it records, and deleted with its chunk transcripts once your notes are saved. Notes, transcripts and projects are sealed with the data key. The five
          Keychain items sit under <span className="font-mono text-ink">dev.aftercall.app</span>, and the NEAR AI key never reaches the app's window. This keeps other apps, and backup or sync tools,
          from reading your meetings. It doesn't protect against someone using your Mac while you're signed in, or software running as you that can open your Keychain.
        </Why>
      </section>

      <section aria-labelledby="pv-leaves" className="flex flex-col gap-3" style={rise(2)}>
        <SectionTitle id="pv-leaves" count={`${PLACES.length} places`}>
          What leaves your Mac
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[200px]" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                {["Where it goes", "What it sees", "What it keeps"].map((h, i) => (
                  <th key={h} scope="col" className={`t-eyebrow pb-2 text-left text-muted ${i < 2 ? "pr-4" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLACES.map((p, i) => {
                const cell = `border-t border-hairline py-2.5 align-top ${i === PLACES.length - 1 ? "border-b" : ""}`;
                return (
                  <tr key={p.name}>
                    <th scope="row" className={`${cell} pr-4 text-left font-normal`}>
                      <span className="flex items-start gap-3">
                        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-well text-ink-2">
                          {p.icon}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-[15px] leading-5 font-semibold text-ink">{p.name}</span>
                          <span className="text-[13px] leading-[19px] text-ink-2">{p.kind}</span>
                        </span>
                      </span>
                    </th>
                    <td className={`${cell} pr-4 text-ink-2`}>{p.sees}</td>
                    <td className={`${cell} text-ink`}>{p.keeps}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Why>
          Draft in Mail, the default, opens a recap in your own mail app, so Aftercall's server never sees it. A claim link keeps the payee's name and the meeting title in the link itself, which
          browsers never send to a server. NEAR AI's hardware check proves the models ran in a TEE; it doesn't prove what NEAR AI's gateway logs. NEAR RPC also sees the account reads and transactions
          the app sends.
        </Why>
      </section>

      <section aria-labelledby="pv-usage" className="flex flex-col gap-3" style={rise(3)}>
        <SectionTitle id="pv-usage">NEAR AI usage</SectionTitle>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-md px-5 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
          <span className="text-ink-2">Billed by NEAR AI on your key, not through Aftercall. The app can't read your usage or cost.</span>
          <Button variant="quiet" size="sm" icon={<ExternalLink size={13} />} onClick={() => openUrl("https://cloud.near.ai").catch(() => window.open("https://cloud.near.ai", "_blank"))}>
            See it at cloud.near.ai
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap gap-6" style={rise(4)}>
        <Backups status={keys?.recovery ?? null} onOpenSettings={onOpenSettings} />
        <DeleteEverything />
      </div>
    </Page>
  );
}

function Backups({ status, onOpenSettings }: { status: RecoveryStatus | null; onOpenSettings: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = isDesktop && !!status?.fromPhrase;

  const exportBackup = async () => {
    setError(null);
    setBusy(true);
    try {
      setSaved(await recovery.exportBackup());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const restored = (r: Restored) => {
    setMessage(`${restoredSummary(r)} Reloading…`);
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <section aria-labelledby="pv-backups" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
      <SectionTitle id="pv-backups" count="one encrypted file">
        Backups
      </SectionTitle>
      <div className="flex flex-col gap-3.5 rounded-md bg-elevated px-5 py-[18px] shadow-1">
        <span className="text-ink-2">Notes, projects, NEAR settings and autopilot rules. Audio and the NEAR AI key stay out.</span>
        {ready ? (
          <span className="flex flex-wrap items-start gap-2">
            <Button variant="primary" loading={busy} onClick={exportBackup}>
              Export backup
            </Button>
            <ImportBackup onRestored={restored} />
          </span>
        ) : (
          <span className="flex flex-col items-start gap-2">
            <span className="text-[13px] leading-[19px] text-ink-2">
              {!isDesktop ? "Backups work in the Mac app, not the browser preview." : "Backups are sealed with a key made from your recovery phrase, so make one first."}
            </span>
            {isDesktop && <Button onClick={onOpenSettings}>Recovery phrase in Settings</Button>}
          </span>
        )}
        {(saved || message || error) && (
          <span className="flex flex-col gap-0.5 border-t border-hairline pt-3 text-[13px] leading-[19px]">
            {saved && (
              <>
                <span>
                  <span className="text-muted">Saved just now</span> ·{" "}
                  <button type="button" onClick={() => revealItemInDir(saved).catch(() => {})} className="rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                    Show in Finder
                  </button>
                </span>
                <span className="selectable font-mono text-[12px] leading-[18px] text-ink-2 [overflow-wrap:anywhere]">{saved.split("/").pop()}</span>
              </>
            )}
            {message && <span className="text-verdigris">{message}</span>}
            {error && <span className="selectable text-record">{error}</span>}
          </span>
        )}
      </div>
      <Why>Only the key made from your recovery phrase opens a backup. On a new Mac, restore your phrase first, then import.</Why>
    </section>
  );
}

const CONFIRM_WORD = "delete";

function DeleteEverything() {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="pv-delete" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
      <SectionTitle id="pv-delete" count="no undo">
        Delete
      </SectionTitle>
      <div className="flex flex-col gap-3.5 rounded-md bg-elevated px-5 py-[18px] shadow-1">
        <span className="text-ink-2">Removes every meeting, note, transcript and project here, and Aftercall's five Keychain items.</span>
        <Button variant="danger" className="self-start" icon={<Trash2 size={14} />} disabled={!isDesktop} onClick={() => setOpen(true)}>
          Delete everything on this Mac
        </Button>
        {!isDesktop && <span className="text-[13px] text-ink-2">This works in the Mac app, not the browser preview.</span>}
        <span className="flex items-start gap-2 border-t border-hairline pt-3 text-[13px] leading-[19px] text-ink-2">
          <Info size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <span>Proofs on NEAR can't be deleted. They hold a hash and the model name, never what was said.</span>
        </span>
      </div>
      <Why>
        Payments on NEAR stay too. This Mac's NEAR key stays authorised on your account until you remove it in your wallet, and your agent wallet keeps its balance on NEAR; withdraw it first if you're
        leaving. Backups you exported, and meetings you copied or printed, stay where you put them.
      </Why>
      <AnimatePresence>{open && <ConfirmDelete key="confirm-delete" onClose={() => setOpen(false)} />}</AnimatePresence>
    </section>
  );
}

/** A danger confirmation that needs the word typed, since nothing here can be undone. */
function ConfirmDelete({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Wiped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = typed.trim().toLowerCase() === CONFIRM_WORD;

  const run = async () => {
    if (!ok || busy) return;
    setError(null);
    setBusy(true);
    try {
      const wiped = await deleteEverything();
      setDone(wiped);
      // Start again from the first-run screen, with nothing left in memory either.
      if (wiped.keychainFailed.length === 0) setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      role="alertdialog"
      onClose={onClose}
      dismissible={!busy && !done}
      width={460}
      initialFocus={cancel}
      title={done ? "Deleted from this Mac" : "Delete everything on this Mac?"}
      intro={done ? undefined : "Every meeting, note, transcript, project and setting here, and Aftercall's five Keychain items. There's no undo."}
    >
      {done ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 flex items-center gap-2 text-ink">
            <ShieldCheck size={16} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
            {done.folderRemoved ? "The data folder is gone" : "There was no data folder"} and {done.keychainRemoved.length} Keychain items are cleared.
          </p>
          {done.keychainFailed.length > 0 ? (
            <>
              <p className="selectable m-0 text-record">The Keychain kept: {done.keychainFailed.join("; ")}. Remove them in Keychain Access (service dev.aftercall.app).</p>
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Start again
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 flex items-center gap-2 text-ink-2">
              <Spinner size={12} /> Starting again…
            </p>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <Field label={`Type “${CONFIRM_WORD}” to confirm`} error={error ?? undefined}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button ref={cancel} variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!ok} loading={busy}>
              Delete everything
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
