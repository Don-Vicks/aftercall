import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { UNDO_SECONDS, agentWallet, awaitsYou, applyItemEdit, holdInterruptedAutopilot, meetingAutopilotDecision, originalItem, projectDeletion, rematchPayees, restoreItem, type FollowUp, type ItemFields, type ItemOptions, type Meeting, type Payee, type PayeeDestination, type ProjectBrief, type BriefSource, type WalletLimits } from "@aftercall/core";
import { loadRules } from "./autopilot";
import { HAS_BACKEND } from "./backend";
import { Sidebar } from "./Sidebar";
import { MeetingScreen } from "./MeetingScreen";
import { ProcessingScreen } from "./ProcessingScreen";
import { RecordSheet } from "./recording/RecordSheet";
import { LivePill } from "./recording/LivePill";
import { LiveScreen } from "./recording/LiveScreen";
import { getSession, openNotes, pressRecordShortcut, useRecordShortcut, useRecordingEvents, useRecordingSession } from "./recording/session";
import { warnAway } from "./recording/notify";
import { sampleDestinations, syncWithAda, syncWithAdaCost, syncWithAdaDropped, syncWithAdaSigned } from "./sample";
import { spendOf } from "./costs";
import { isDesktop, recorder, type SavedRecording } from "./recorder";
import { IS_DEMO } from "./demo";
import { RecordingScreen } from "./RecordingScreen";
import { parseNotes, serializeNotes, type SavedNotes } from "./nearai";
import { ConnectNear } from "./ConnectNear";
import { SampleVerifySheet, VerifySheet } from "./VerifySheet";
import { HomeScreen } from "./HomeScreen";
import { SearchScreen } from "./SearchScreen";
import { WalletScreen, type BlockedPayment } from "./WalletScreen";
import { near } from "./near";
import { recordingFiles } from "./nearai";
import {
  claimedAccounts,
  confirmClaim,
  createClaim,
  draftInMail,
  emailDealLink,
  escrowInWallet,
  holdInEscrow,
  latestPreview,
  pay,
  payCrossChain,
  postToSlack,
  previewCrossChain,
  refreshEscrow,
  releaseEscrow,
  sendRecap,
  waitingForClaims,
  waitingOnEscrows,
  type Patch,
} from "./followUpActions";
import { usePhoneSync } from "./phoneSync";
import { dailyCap as sampleDailyCap, paidBySample, payees as samplePayees, perPaymentCap as samplePerPaymentCap, walletBalance as sampleBalance } from "./sample";
import { deleteRecording, moveRecordings, projectId, projectsApi, type Project } from "./projects";
import { NewProjectSheet } from "./NewProjectSheet";
import { Onboarding, needsOnboarding } from "./Onboarding";
import { eventTitles } from "./calendar";
import { AgentsScreen } from "./AgentsScreen";
import { agentsApi } from "./agents";
import { openSample } from "./sampleRecordings";
import { CommandPalette } from "./CommandPalette";
import { ProjectScreen } from "./ProjectScreen";
import { DialogHost, MeProvider, MotionProvider, Toaster, anyLayerOpen, deferred, toast, useConfirm, view as viewMotion } from "./ui";
import { PeopleScreen } from "./PeopleScreen";
import { PersonScreen } from "./PersonScreen";
import { AskScreen } from "./AskScreen";
import { MeetingsScreen } from "./MeetingsScreen";
import { ActionItemsScreen } from "./ActionItemsScreen";
import { PrivacyScreen } from "./PrivacyScreen";
import { libraryMeetings } from "./library";
import { autoBackup } from "./recovery";

type View =
  | { name: "home" }
  | { name: "search"; query?: string }
  | { name: "project"; id: string }
  // Screens built on another branch; until they land, a placeholder says so.
  | { name: "meeting"; id: string; at?: number }
  | { name: "processing"; project: string; seconds: number }
  | { name: "recording"; id: string }
  | { name: "live" }
  | { name: "settings" }
  | { name: "agents" }
  | { name: "wallet" }
  | { name: "people" }
  | { name: "person"; id: string }
  | { name: "ask"; question?: string }
  | { name: "meetings" }
  | { name: "actions" }
  | { name: "privacy" }
  | { name: "placeholder"; title: string; milestone: string };

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Follows the system light/dark setting. */
function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => (document.documentElement.dataset.theme = mq.matches ? "light" : "dark");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

export default function App() {
  useSystemTheme();
  const [meetings, setMeetings] = useState<Record<string, Meeting>>({ [syncWithAda.id]: syncWithAda });
  // The browser demo opens on the sample meeting's notes: it has no audio to make notes from.
  const [view, setView] = useState<View>(IS_DEMO ? { name: "meeting", id: syncWithAda.id } : { name: "home" });
  /**
   * Opens the library screens. The sidebar's onOpenPeople, onOpenAsk, onOpenMeetings and
   * onOpenActions call go.people, go.ask, go.meetings and go.actions.
   */
  const go = {
    people: () => setView({ name: "people" }),
    person: (id: string) => setView({ name: "person", id }),
    /** With a question, Ask asks it at once (from "Ask about Ada"). */
    ask: (question?: unknown) => setView({ name: "ask", question: typeof question === "string" ? question : undefined }),
    meetings: () => setView({ name: "meetings" }),
    actions: () => setView({ name: "actions" }),
    privacy: () => setView({ name: "privacy" }),
  };
  const [recordOpen, setRecordOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** New recording: the sheet, or the recording's own page while one is running. */
  const newRecording = () => (getSession().phase === "idle" ? setRecordOpen(true) : setView({ name: "live" }));
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  /** notes.json of processed recordings, by id: the proof and checks behind each meeting. */
  const [saved, setSaved] = useState<Record<string, SavedNotes>>({});
  const [verifyId, setVerifyId] = useState<string | null>(null);
  /** The sample meeting's Verify sheet: the real checks re-run on a test proof. */
  const [sampleVerify, setSampleVerify] = useState(false);
  /** Why a meeting's proof failed to go on NEAR when its notes were made, by id, until it is recorded. */
  const [proofErrors, setProofErrors] = useState<Record<string, string>>({});
  /**
   * From the agent-wallet contract once NEAR is connected; none until then, so a real
   * call's transcription and notes never hear the sample's names. Samples (and the
   * browser preview) use the sample payees instead.
   */
  const [payees, setPayees] = useState<Payee[]>(isDesktop ? [] : samplePayees);
  /** True once the payee list has been read from the contract, so an empty list means "none", not "not read yet". */
  const [payeesRead, setPayeesRead] = useState(false);
  const [limits, setLimits] = useState<WalletLimits | null>(null);
  /** Today's cap, for a held payment's wallet page (with `limits.leftToday`). */
  const [dailyCap, setDailyCap] = useState<bigint | null>(null);
  /** Payees the owner opted in to payment on Solana or Base, by NEAR account. */
  const [destinations, setDestinations] = useState<Record<string, PayeeDestination>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [createdProject, setCreatedProject] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<Project | null>(null);

  /** Moves recordings (on disk and in memory) from one project name to another. */
  const refile = async (from: string, to: string) => {
    await moveRecordings(from, to);
    setRecordings((all) => all.map((r) => (r.project === from ? { ...r, project: to } : r)));
    setMeetings((all) => Object.fromEntries(Object.entries(all).map(([id, m]) => [id, m.project === from && id !== syncWithAda.id ? { ...m, project: to } : m])));
  };

  const renameProject = async (p: Project, name: string) => {
    const next = projects.map((x) => (x.id === p.id ? { ...x, name } : x));
    await projectsApi.save(next);
    await refile(p.name, name);
    setProjects(next);
    setRenaming(null);
  };

  const confirm = useConfirm();
  const deleteProject = async (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    // Which projects agents may reach, so the meetings never move to one they can reach when this one is kept from them.
    const reach = isDesktop ? await agentsApi.info().then((i) => i.projects, () => undefined) : null;
    if (reach === undefined) {
      toast({ text: "Couldn't read which projects agents can reach, so nothing was deleted. Try again.", tone: "record" });
      return;
    }
    const count = recordings.filter((r) => r.project === p.name).length;
    const plan = projectDeletion(projects, id, reach, count);
    if (!plan) {
      toast({ text: "Keep at least one project. Rename this one instead.", tone: "caution" });
      return;
    }
    const { target } = plan;
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      body: count
        ? `Its ${count} ${count === 1 ? "meeting moves" : "meetings move"} to “${target.name}”.${plan.keepsTarget ? ` Agents can't reach ${p.name}, so from now on they can't reach ${target.name} either.` : ""}`
        : undefined,
      confirmLabel: "Delete project",
      tone: "danger",
    });
    if (!ok) return;
    // Before anything moves, so agents never reach the meetings in between.
    if (plan.agentProjects) await agentsApi.setProjects(plan.agentProjects);
    const next = projects.filter((x) => x.id !== id);
    await projectsApi.save(next);
    if (count) await refile(p.name, target.name);
    setProjects(next);
    setView((v) => (v.name === "project" && v.id === id ? { name: "home" } : v));
  };
  const [onboarding, setOnboarding] = useState(needsOnboarding);
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(() => setProjects([{ id: "general", name: "General" }]));
  }, []);

  const createProject = async (name: string, brief?: ProjectBrief, briefSource?: BriefSource) => {
    const next = [...projects, { id: projectId(name), name, ...(brief ? { brief } : {}), ...(brief && briefSource ? { briefSource } : {}) }];
    await projectsApi.save(next);
    setProjects(next);
    setCreatedProject(name);
    setNewProjectOpen(false);
  };

  /** Saves one project's brief; undefined clears it (and where it came from). `source`: undefined keeps it, null drops it. */
  const saveBrief = async (id: string, brief: ProjectBrief | undefined, source?: BriefSource | null) => {
    const next = projects.map((p) => {
      if (p.id !== id) return p;
      const { brief: _old, briefSource: oldSource, ...rest } = p;
      const briefSource = source === undefined ? oldSource : (source ?? undefined);
      return brief ? { ...rest, brief, ...(briefSource ? { briefSource } : {}) } : rest;
    });
    await projectsApi.save(next);
    setProjects(next);
  };
  /** Saves or (undefined) clears one project's code folder, where "Open in Claude Code" starts. */
  const saveCodeFolder = async (id: string, codeFolder: string | undefined) => {
    const next = projects.map((p) => {
      if (p.id !== id) return p;
      const { codeFolder: _old, ...rest } = p;
      return codeFolder ? { ...rest, codeFolder } : rest;
    });
    await projectsApi.save(next);
    setProjects(next);
  };
  /** Briefs by project name, for Ask and the notes of a recording in that project. */
  const briefs = Object.fromEntries(projects.map((p) => [p.name, p.brief]));

  /** Meetings deleted in the last few seconds: hidden everywhere, still on disk until their Undo runs out. */
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const unhide = (id: string) =>
    setHidden((all) => {
      const { [id]: _back, ...rest } = all;
      return rest;
    });

  /**
   * Deletes a recording and its notes from this Mac, softly: it disappears at once
   * and the files go 6 seconds later unless Undo comes first. Quitting in between
   * deletes nothing. A proof already on NEAR stays there.
   */
  const removeRecording = (id: string) => {
    const r = recordings.find((x) => x.id === id);
    const title = meetings[id]?.title ?? r?.eventTitle ?? r?.title;
    setHidden((all) => ({ ...all, [id]: true }));
    setView((v) => ((v.name === "meeting" || v.name === "recording") && v.id === id ? { name: "home" } : v));
    setVerifyId((v) => (v === id ? null : v));
    deferred({
      id: `delete-meeting:${id}`,
      text: title ? `Deleted “${title}”` : "Meeting deleted",
      ms: 6000,
      undo: () => unhide(id),
      run: async () => {
        try {
          await deleteRecording(id);
        } catch (e) {
          unhide(id);
          toast({ text: `Couldn't delete the meeting: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
          return;
        }
        delete diskNotes.current[id];
        setRecordings((all) => all.filter((x) => x.id !== id));
        setMeetings((all) => {
          const { [id]: _gone, ...rest } = all;
          return rest;
        });
        setSaved((all) => {
          const { [id]: _gone, ...rest } = all;
          return rest;
        });
        unhide(id);
      },
    });
  };
  /** Copies a fictional sample call in as a recording labelled "Sample" and opens it. */
  const openSampleRecording = async (sampleId: string, project?: string) => {
    try {
      const r = await openSample(sampleId, project ?? projects[0]?.name ?? "General");
      setRecordings((all) => [r, ...all.filter((x) => x.id !== r.id)]);
      setRecordOpen(false);
      setView({ name: "recording", id: r.id });
    } catch (e) {
      toast({ text: `Couldn't open the sample: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
    }
  };

  const refreshWallet = useCallback(async () => {
    const config = isDesktop ? await near.getConfig().catch(() => null) : null;
    setAccount(config?.account ?? null);
    if (!config) {
      // No account: agents lose the payees and caps they had, so they propose no payments.
      if (isDesktop) agentsApi.setWallet(null).catch(() => {});
      return;
    }
    try {
      const v = await near.wallet();
      setBalance(v.wallet ? BigInt(v.wallet.balance) : null);
      const listed = v.payees.map((p) => ({ name: p.label, account: p.account }));
      setPayees(listed);
      setPayeesRead(true);
      setDestinations(Object.fromEntries((v.destinations ?? []).map((d) => [d.payee, { chain: d.chain, address: d.address }])));
      // What agents may propose a payment to, and up to how much: the same list and caps, or none without a wallet.
      const forAgents = agentWallet(v.wallet, listed, Date.now());
      agentsApi.setWallet(forAgents).catch(() => {});
      if (v.wallet && forAgents) {
        setLimits({ leftToday: BigInt(forAgents.leftToday), perPaymentCap: BigInt(v.wallet.per_payment_cap) });
        setDailyCap(BigInt(v.wallet.daily_cap));
      }
    } catch {
      // Offline or not set up: keep what we have.
    }
  }, []);

  /** True once the first wallet read finished (or there's no NEAR account): payees' routes are known. */
  const [walletChecked, setWalletChecked] = useState(!isDesktop);
  useEffect(() => {
    refreshWallet().finally(() => setWalletChecked(true));
  }, [refreshWallet]);
  // Opening the wallet reads it again, for the app and for agents: after another account is saved they have none until then.
  useEffect(() => {
    if (view.name === "wallet") void refreshWallet();
  }, [view.name, refreshWallet]);
  // Coming back to the window reads it again too: a payee, cap or key changed by signing on
  // /sign in the browser is then on the list before the next call's notes are made. At most
  // once every 10 s, since each read is two RPC calls.
  useEffect(() => {
    if (!isDesktop) return;
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 10_000) return;
      last = Date.now();
      void refreshWallet();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshWallet]);

  /** Follow-ups autopilot queued since this launch, as "meeting:follow-up". Only these keep a countdown read from disk. */
  const queuedHere = useRef(new Set<string>());

  /** notes.json as last read from disk, by id, to spot changes made outside the app (agents, via the MCP server). */
  const diskNotes = useRef<Record<string, string>>({});
  /** Each meeting's last notes.json save, so saves land in the order they were made. */
  const notesSaves = useRef<Record<string, Promise<void>>>({});

  /**
   * Saves a meeting's notes.json, one save at a time per meeting, and takes it as what
   * is on disk, so the refresh doesn't read the app's own save as an outside change.
   */
  const writeNotes = (id: string, notes: SavedNotes) => {
    const text = serializeNotes(notes);
    diskNotes.current[id] = text;
    notesSaves.current[id] = (notesSaves.current[id] ?? Promise.resolve()).then(() => recordingFiles.saveNotes(id, text)).catch(() => {});
    // With the switch on, the change reaches today's automatic backup a minute later.
    autoBackup.soon();
  };

  // Recordings that have notes open as meetings. Autopilot queued before this launch
  // (Aftercall closed during the undo window) is held for you and saved that way.
  const addProcessed = (list: SavedRecording[]) => {
    const processed: Record<string, Meeting> = {};
    const notes: Record<string, SavedNotes> = {};
    for (const r of list) {
      if (!r.notes) continue;
      try {
        const parsed = parseNotes(r.notes);
        const held = holdInterruptedAutopilot(parsed.meeting, (fuId) => queuedHere.current.has(`${r.id}:${fuId}`));
        notes[r.id] = held ? { ...parsed, meeting: held } : parsed;
        processed[r.id] = notes[r.id].meeting;
        if (held && isDesktop) writeNotes(r.id, notes[r.id]);
      } catch {
        // A damaged notes.json leaves the recording on its status page.
      }
    }
    setMeetings((all) => ({ ...all, ...processed }));
    setSaved((all) => ({ ...all, ...notes }));
  };

  /** Names recordings that have no notes yet after their calendar event, when there is one. */
  const nameFromCalendar = (list: SavedRecording[]) =>
    eventTitles(list).then((titles) => setRecordings((all) => all.map((r) => (titles[r.id] && !r.notes ? { ...r, eventTitle: titles[r.id] } : r))));

  /** Takes notes.json from disk as the truth for one meeting. */
  const applyDiskNotes = (id: string, notes: string) => {
    diskNotes.current[id] = notes;
    setRecordings((all) => all.map((r) => (r.id === id ? { ...r, notes } : r)));
    addProcessed([{ id, notes } as SavedRecording]);
  };

  /** True once saved recordings are read from disk; a paired phone's snapshots and taps wait for it. */
  const [libraryLoaded, setLibraryLoaded] = useState(!isDesktop);

  // With the switch on, an automatic backup when the newest is over a day old. It never throws.
  useEffect(() => {
    if (isDesktop) void autoBackup.run(true);
  }, []);

  // Saved recordings from earlier sessions.
  useEffect(() => {
    if (!isDesktop) return;
    recorder
      .list()
      .then((list) => {
        for (const r of list) if (r.notes) diskNotes.current[r.id] = r.notes;
        setRecordings(list);
        addProcessed(list);
        nameFromCalendar(list);
      })
      .catch(() => setRecordings([]))
      .finally(() => setLibraryLoaded(true));
  }, []);

  // Agents claim and complete action items by writing notes.json; pick that up
  // when the window gets focus, and every few seconds while it's on screen.
  useEffect(() => {
    if (!isDesktop) return;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const list = await recorder.list().catch(() => []);
      for (const r of list) if (r.notes && r.notes !== diskNotes.current[r.id]) applyDiskNotes(r.id, r.notes);
    };
    window.addEventListener("focus", refresh);
    const t = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(t);
    };
  }, []);

  // A payment heard before its payee was on the list waits as "not on your list". Once
  // the list is read (or changes), saved meetings' waiting payments are matched again,
  // by the same rule as when the notes were made, and saved like any other follow-up change.
  // Sample recordings keep the sample payees they were made with.
  useEffect(() => {
    if (!isDesktop || !payeesRead) return;
    const samples = new Set(recordings.filter((r) => r.label).map((r) => r.id));
    for (const [id, notes] of Object.entries(saved)) {
      if (hidden[id] || samples.has(id)) continue;
      const meeting = rematchPayees(notes.meeting, payees);
      if (meeting === notes.meeting) continue;
      const updated = { ...notes, meeting };
      writeNotes(id, updated);
      setSaved((all) => (all[id] === notes ? { ...all, [id]: updated } : all));
      setMeetings((all) => (all[id] ? { ...all, [id]: rematchPayees(all[id], payees) } : all));
    }
  }, [payees, payeesRead, saved, hidden, recordings]);

  const paletteBlocked = useRef(false);
  paletteBlocked.current = onboarding || recordOpen;
  // ⌘⇧R, here or (Mac app) from any app. While recording it opens your notes instead.
  // The open record sheet takes it over to start.
  useRecordShortcut(() => {
    if (getSession().phase === "idle") setRecordOpen(true);
    else openNotes();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        pressRecordShortcut();
      }
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // ⌘K toggles the palette. It doesn't open over another dialog, a menu, onboarding or the record panel.
        setPaletteOpen((open) => (open ? false : !anyLayerOpen() && !paletteBlocked.current));
      }
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "j" && !anyLayerOpen() && !paletteBlocked.current) {
        e.preventDefault();
        setView({ name: "ask" });
      }
    };
    window.addEventListener("keydown", onKey);
    // "New recording…" in the menu bar item opens the panel.
    const offMenu = isDesktop ? recorder.onMenuNewRecording(newRecording) : null;
    const offShortcut = isDesktop ? recorder.onShortcut(pressRecordShortcut) : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      offMenu?.then((f) => f());
      offShortcut?.then((f) => f());
    };
  }, []);

  const update = (id: string, fn: (m: Meeting) => Meeting) => setMeetings((all) => ({ ...all, [id]: fn(all[id]) }));

  /** Ticks an action item; for real meetings the tick is saved in notes.json, where agents see it too. */
  const toggleItem = (meetingId: string, itemId: string) => {
    const item = meetings[meetingId]?.actionItems.find((a) => a.id === itemId);
    if (!item) return;
    const done = !item.done;
    update(meetingId, (m) => ({ ...m, actionItems: m.actionItems.map((a) => (a.id === itemId ? { ...a, done, completed: done ? a.completed : undefined } : a)) }));
    if (isDesktop && saved[meetingId]) {
      agentsApi
        .setItemDone(meetingId, itemId, done)
        .then((notes) => applyDiskNotes(meetingId, notes))
        .catch((e) => {
          // Not saved: the tick goes back, says why, and the meeting re-reads what is on disk.
          update(meetingId, (m) => ({ ...m, actionItems: m.actionItems.map((a) => (a.id === itemId ? item : a)) }));
          toast({ text: `Couldn't save “${item.text}”: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
          recorder.list().then((list) => list.forEach((r) => r.id === meetingId && r.notes && applyDiskNotes(r.id, r.notes)));
        });
    }
  };

  /** What the model signed for a meeting's action items: notes.json, or the sample's own in the preview. */
  const originalOf = (meetingId: string, itemId: string): ItemFields | null =>
    originalItem(saved[meetingId]?.notes ?? (meetingId === syncWithAda.id ? syncWithAdaSigned : undefined), itemId);

  /**
   * Your edit of an action item's text, owner and due date (null puts back what the
   * model signed). Shown at once; for real meetings saved in notes.json, where search,
   * people, recaps and agents read it. The signed notes and the proof never change.
   */
  const editItem = (meetingId: string, itemId: string, fields: ItemFields | null) => {
    const item = meetings[meetingId]?.actionItems.find((a) => a.id === itemId);
    const original = originalOf(meetingId, itemId);
    if (!item || !original) return;
    const next = fields ? applyItemEdit(item, original, fields, new Date().toISOString()) : restoreItem(item, original);
    update(meetingId, (m) => ({ ...m, actionItems: m.actionItems.map((a) => (a.id === itemId ? { ...next, done: a.done, claimed: a.claimed, completed: a.completed } : a)) }));
    if (isDesktop && saved[meetingId]) {
      agentsApi
        .editItem(meetingId, itemId, fields)
        .then((notes) => applyDiskNotes(meetingId, notes))
        .catch((e) => {
          // Not saved: the item goes back, says why, and the meeting re-reads what is on disk.
          update(meetingId, (m) => ({ ...m, actionItems: m.actionItems.map((a) => (a.id === itemId ? item : a)) }));
          toast({ text: `Couldn't save your edit: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });
          recorder.list().then((list) => list.forEach((r) => r.id === meetingId && r.notes && applyDiskNotes(r.id, r.notes)));
        });
    }
  };

  /**
   * Changes one follow-up and, for real meetings, saves it to the meeting's notes.json.
   * Reads the latest saved notes, not this render's: autopilot queues right after a
   * meeting is processed, before a render has its notes.
   */
  const patchFollowUp = (meetingId: string, fuId: string, patch: Patch) => {
    setMeetings((all) => {
      const m = all[meetingId];
      const next = { ...m, followUps: m.followUps.map((f) => (f.id === fuId ? ({ ...f, ...patch } as FollowUp) : f)) };
      setSaved((s) => {
        const notes = s[meetingId];
        if (!notes) return s;
        const updated = { ...notes, meeting: next };
        writeNotes(meetingId, updated);
        return { ...s, [meetingId]: updated };
      });
      return { ...all, [meetingId]: next };
    });
  };

  const handlersFor = (meeting: Meeting) => {
    const find = (id: string) => meeting.followUps.find((f) => f.id === id)!;
    const apply = (id: string) => (patch: Patch) => patchFollowUp(meeting.id, id, patch);
    const sample = meeting.id === syncWithAda.id;
    return {
      /**
       * Sends or pays it. `via` "phone": you approved it on your paired phone, and the Mac
       * re-checked it (phoneSync.ts); the same path runs, and once it went out it's
       * marked as approved there, as autopilot marks its own.
       */
      onApprove: (id: string, via?: "phone") => {
        const f = find(id);
        // Set or cleared each time it goes out, so a recap sent again from the Mac isn't credited to the phone.
        const apply = (fuId: string) => (patch: Patch) =>
          patchFollowUp(meeting.id, fuId, patch.status === "sent" || patch.status === "paid" ? { ...patch, byPhone: via === "phone" || undefined } : patch);
        if (sample) {
          // The sample meeting only simulates the round trip, under the sample wallet's rules, as
          // the contract would: a payment over the per-payment cap or past today's cap waits for
          // your wallet, whatever the balance; under the caps, more than the balance is refused.
          // What the sample already paid comes off the balance and counts towards today.
          const amount = f.kind === "payment" ? f.amount : null;
          const paid = paidBySample(meeting);
          const outcome: Patch =
            f.kind === "email"
              ? { status: "sent", doneAt: nowHHMM() }
              : amount !== null && (amount > samplePerPaymentCap || paid + amount > sampleDailyCap)
                ? { status: "blocked" }
                : amount !== null && amount > sampleBalance - paid
                  ? { status: "proposed", error: "Not enough USDC in your agent wallet. Deposit some first." }
                  : { status: "paid", doneAt: nowHHMM() };
          apply(id)({ status: "sending", error: undefined });
          setTimeout(() => apply(id)(outcome), 1600);
          return;
        }
        if (f.kind === "email") sendRecap(meeting, f, apply(id), saved[meeting.id]);
        else if (destinations[f.payeeAccount]) payCrossChain(meeting, f, destinations[f.payeeAccount], apply(id), saved[meeting.id]).then(refreshWallet);
        else pay(meeting, f, apply(id), saved[meeting.id]).then(refreshWallet);
      },
      routeFor: (f: FollowUp) => (f.kind !== "payment" ? null : ((sample ? sampleDestinations : destinations)[f.payeeAccount] ?? null)),
      previewRoute: previewCrossChain,
      // A held item keeps its flag, so Undo brings back why it waits; it shows only while proposed.
      // `via` "phone": dismissed on your paired phone, and labelled so on the card and the trail.
      onDismiss: (id: string, via?: "phone") => apply(id)({ status: "dismissed", autopilotAt: undefined, byPhone: via === "phone" || undefined }),
      onRestore: (id: string, status: FollowUp["status"]) => apply(id)({ status }),
      onUndoAutopilot: (id: string) => apply(id)({ autopilotAt: undefined }),
      onSetAmount: (id: string, amount: bigint) => apply(id)({ amount, autopilotAt: undefined, autopilotHeld: undefined, error: undefined }),
      onReviewBlocked: () => setView({ name: "wallet" }),
      onDraft: (id: string) => {
        const f = find(id);
        if (f.kind !== "email") return;
        if (!isDesktop) return void toast({ text: "In the Mac app this opens the recap as a draft in Mail. The browser preview can't." });
        // The sample never went to NEAR AI, so a footer about checks and deleted audio would be untrue.
        if (sample) return void toast({ text: "The sample meeting is made up, so it has no recap to draft. Record a call to draft one in Mail." });
        draftInMail(meeting, f, saved[meeting.id])
          .then(() => apply(id)({ draftedAt: nowHHMM(), autopilotAt: undefined, autopilotHeld: undefined }))
          .catch((e) => toast({ text: `Couldn't open Mail: ${e instanceof Error ? e.message : String(e)}`, tone: "record" }));
      },
      // Your tap only: autopilot and the phone go through onApprove, which never posts to Slack.
      // It rejects with plain words for the card to show; posted, it's marked like a draft.
      onPostToSlack: async (id: string) => {
        const f = find(id);
        if (f.kind !== "email") return;
        // The sample never went to NEAR AI, so a footer about checks and deleted audio would be untrue.
        if (sample) return void toast({ text: "The sample meeting is made up, so it has no recap to post. Record a call to post one to Slack." });
        await postToSlack(meeting, f, saved[meeting.id]);
        apply(id)({ slackPostedAt: nowHHMM(), autopilotAt: undefined, autopilotHeld: undefined });
      },
      onSetEmail: (id: string, email: string) => apply(id)({ to: email, error: undefined }),
      onClaimLink: (id: string) => {
        const f = find(id);
        if (f.kind === "payment") createClaim(meeting, f, apply(id));
      },
      onConfirmClaim: (id: string) => {
        const f = find(id);
        if (f.kind === "payment") confirmClaim(f, apply(id)).then(refreshWallet);
      },
      onAskToConfirm: (id: string) => {
        const f = find(id);
        if (f.kind !== "payment") return;
        if (sample || !isDesktop) return void toast({ text: "Holding a deal in escrow needs the Mac app and a meeting whose proof is on NEAR. The sample meeting has neither." });
        holdInEscrow(meeting, f, apply(id), saved[meeting.id]).then(refreshWallet);
      },
      onReleaseEscrow: (id: string) => {
        const f = find(id);
        if (f.kind === "payment") releaseEscrow(f, apply(id)).then(refreshWallet);
      },
      onEscrowInWallet: (id: string, kind: "approve-escrow" | "cancel-escrow") => {
        const f = find(id);
        if (f.kind === "payment") escrowInWallet(f, kind, apply(id));
      },
      onEmailDeal: (id: string, to: string) => {
        const f = find(id);
        if (f.kind === "payment") emailDealLink(f, to, apply(id));
      },
    };
  };

  /** Queues what autopilot may do in a freshly processed meeting, each with an undo window. */
  const scheduleAutopilot = (m: Meeting) => {
    const rules = loadRules();
    const at = Date.now() + UNDO_SECONDS * 1000;
    for (const f of m.followUps) {
      // A payment on another chain needs a fresh quote the person has seen: never autopilot.
      if (f.kind === "payment" && destinations[f.payeeAccount]) continue;
      // Recaps go out through the backend; a build without one leaves them for Draft in Mail.
      if (f.kind === "email" && !HAS_BACKEND) continue;
      // Only from verified notes, and only when every rule passes.
      if (!meetingAutopilotDecision(m, f, rules, limits).run) continue;
      queuedHere.current.add(`${m.id}:${f.id}`);
      patchFollowUp(m.id, f.id, { autopilotAt: at });
    }
  };

  // Runs autopilot follow-ups whose undo window has passed.
  useEffect(() => {
    // A meeting waiting out its delete Undo runs nothing.
    const due = Object.values(meetings)
      .filter((m) => !hidden[m.id])
      .flatMap((m) => m.followUps.filter((f) => f.autopilotAt).map((f) => ({ m, f })));
    if (due.length === 0) return;
    const t = setInterval(() => {
      for (const { m, f } of due) {
        if (f.autopilotAt && f.autopilotAt <= Date.now()) {
          patchFollowUp(m.id, f.id, { autopilotAt: undefined });
          // Re-check every rule at the moment it runs: limits may have changed.
          if (!meetingAutopilotDecision(m, f, loadRules(), limits).run) continue;
          if (f.kind === "payment" && destinations[f.payeeAccount]) continue;
          // Marked as autopilot's only once it went out, so a later manual approval isn't credited to it.
          const apply = (patch: Patch) => patchFollowUp(m.id, f.id, patch.status === "sent" || patch.status === "paid" ? { ...patch, byAutopilot: true } : patch);
          if (f.kind === "email") sendRecap(m, f, apply, saved[m.id]);
          else pay(m, f, apply, saved[m.id]).then(refreshWallet);
        }
      }
    }, 1000);
    return () => clearInterval(t);
  });

  // While a payee hasn't answered a claim link, check every 15 seconds.
  const meetingList = Object.values(meetings);
  const anyWaiting = waitingForClaims(meetingList);
  useEffect(() => {
    if (!anyWaiting) return;
    const t = setInterval(async () => {
      const shared = await claimedAccounts().catch(() => ({}) as Record<string, string>);
      for (const m of Object.values(meetings)) {
        for (const f of m.followUps) {
          if (f.kind === "payment" && f.claim && !f.claim.account && shared[f.claim.id]) {
            patchFollowUp(m.id, f.id, { claim: { ...f.claim, account: shared[f.claim.id] } });
          }
        }
      }
    }, 15_000);
    return () => clearInterval(t);
  });

  // While a deal waits on the payee or on you, read its escrow every 15 seconds.
  const anyEscrow = waitingOnEscrows(meetingList);
  useEffect(() => {
    if (!anyEscrow || !isDesktop) return;
    const t = setInterval(() => {
      for (const m of Object.values(meetings)) {
        for (const f of m.followUps) {
          if (f.kind === "payment" && f.escrow) refreshEscrow(f, (patch) => patchFollowUp(m.id, f.id, patch)).catch(() => {});
        }
      }
    }, 15_000);
    return () => clearInterval(t);
  });

  const blocked: BlockedPayment[] = meetingList
    // The browser preview has no saved notes: there, the sample wallet's parked payment is the sample meeting's.
    .filter((m) => (saved[m.id] || (!isDesktop && m.id === syncWithAda.id)) && !hidden[m.id])
    .flatMap((m) => m.followUps.filter((f) => f.kind === "payment" && f.status === "blocked").map((f) => ({ meeting: m, followUp: f as BlockedPayment["followUp"] })));

  const finishProcessing = useCallback(() => setView({ name: "meeting", id: syncWithAda.id }), []);

  const pendingByMeeting = Object.fromEntries(
    Object.values(meetings).map((m) => [m.id, m.followUps.filter(awaitsYou).length]),
  );

  const selectedMeetingId = view.name === "meeting" || view.name === "recording" ? view.id : null;
  // Processing can finish after the user has left the recording, so this reads
  // the latest state instead of the closure the run started with.
  const onProcessedRef = useRef((_id: string, _notes: string, _proofError?: string) => {});
  onProcessedRef.current = (id, notes, proofError) => {
    const recording = recordings.find((r) => r.id === id);
    if (!recording) return;
    if (proofError) setProofErrors((all) => ({ ...all, [id]: proofError }));
    const updated = { ...recording, notes };
    // The run saved these notes itself; the refresh needn't read them back.
    diskNotes.current[id] = notes;
    setRecordings((all) => all.map((r) => (r.id === id ? updated : r)));
    addProcessed([updated]);
    const processed = parseNotes(notes).meeting;
    setTimeout(() => scheduleAutopilot(processed), 0);
    // With the switch on, the new notes go into today's automatic backup. It never throws.
    void autoBackup.run(false);
  };

  // However a recording stops (pill, floating recorder, menu bar), its page opens.
  useRecordingEvents({
    onStopped: ({ saved, project, seconds }) => {
      setRecordOpen(false);
      if (saved) {
        // A real recording: show it as its own meeting, with its true status.
        setRecordings((all) => [saved, ...all.filter((r) => r.id !== saved.id)]);
        nameFromCalendar([saved]);
        setView({ name: "recording", id: saved.id });
      } else {
        // Browser preview: walk through the simulated pipeline on sample data.
        setView({ name: "processing", project, seconds });
      }
    },
    onOpenLive: () => setView({ name: "live" }),
    onOpenMeeting: (id) => setView(meetings[id] ? { name: "meeting", id } : { name: "recording", id }),
    onWarning: (w) => void warnAway(w),
  });

  const openRecording = view.name === "recording" ? recordings.find((r) => r.id === view.id) : undefined;
  const meetingTitles = Object.fromEntries(Object.values(meetings).map((m) => [m.id, m.title]));
  const meeting = selectedMeetingId ? meetings[selectedMeetingId] : undefined;
  // Everything on screen leaves out meetings that are waiting out their delete Undo.
  // Kept between renders, so a paired phone's snapshot is rebuilt only when a meeting changes.
  const shownMeetings = useMemo(() => Object.values(meetings).filter((m) => !hidden[m.id]), [meetings, hidden]);
  const shownRecordings = recordings.filter((r) => !hidden[r.id]);
  const rules = loadRules();
  const autopilotOn = rules.payments || rules.recapDomains.length > 0;
  /** One key per screen, so switching screens fades between them. */
  const viewKey = view.name === "meeting" || view.name === "recording" || view.name === "project" || view.name === "person" ? `${view.name}:${view.id}` : view.name;
  const openProject = view.name === "project" ? projects.find((p) => p.id === view.id) : undefined;
  const openActions = shownMeetings.reduce((n, m) => n + m.actionItems.filter((a) => !a.done).length, 0);
  /** Names that mean "you" in the notes: your NEAR account, once connected ("You" and "Me" always do). */
  const me = useMemo(() => (account ? [account] : []), [account]);
  /** The recording in progress, for the sidebar's live row and Home's live card. */
  const session = useRecordingSession();
  const recordingNow = session.phase === "recording" || session.phase === "paused";
  const live = recordingNow ? { seconds: session.seconds, paused: session.phase === "paused", title: session.event?.title, project: session.project } : undefined;
  const openLive = () => setView({ name: "live" });
  /** What People, Ask, All meetings and Action items read: every meeting not waiting out a delete. */
  const library = useMemo(() => libraryMeetings(Object.values(meetings).filter((m) => !hidden[m.id]), syncWithAda.id), [meetings, hidden]);
  const sampleIds = new Set([syncWithAda.id, ...recordings.filter((r) => r.label === "Sample").map((r) => r.id)]);
  const openMeeting = (id: string, at?: number) => setView(meetings[id] ? { name: "meeting", id, at } : { name: "recording", id });
  /** The agent wallet's figure: from NEAR on this Mac; the sample wallet less what the sample paid in the browser preview. */
  const walletBalance = isDesktop ? balance : sampleBalance - paidBySample(meetings[syncWithAda.id]);

  /** A held payment your wallet paid or declined: from the wallet screen, or found on NEAR while a phone is paired. */
  const resolveHeld = (meetingId: string, fuId: string, status: "paid" | "dismissed") => {
    // Decided in your wallet, not on the phone: no "on your phone" label.
    patchFollowUp(meetingId, fuId, { status, doneAt: status === "paid" ? nowHHMM() : undefined, byPhone: undefined });
    refreshWallet();
  };

  /**
   * The options the follow-up cards use, for a paired phone's snapshot. Kept between
   * renders: `routeFor` reads only `destinations`. A newer preview quote rides along
   * with the next snapshot.
   */
  const phoneOptions = useCallback(
    (m: Meeting, f: FollowUp): ItemOptions => {
      const route = handlersFor(m).routeFor(f);
      const quoted = route && f.kind === "payment" ? latestPreview(f, route) : undefined;
      return { backend: HAS_BACKEND, claimLinks: HAS_BACKEND, route, ...(quoted ? { quoted } : {}), ...(m.id === syncWithAda.id ? { sample: true } : {}) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinations],
  );
  const phoneWallet = useMemo(() => (limits && dailyCap !== null ? { leftToday: limits.leftToday, dailyCap } : null), [limits?.leftToday, dailyCap]);

  // A paired phone sees what waits (the same items the cards show, built with the same
  // options) and sends back taps, which run through these same handlers once re-checked.
  usePhoneSync({
    ready: libraryLoaded && walletChecked,
    account,
    meetings: shownMeetings,
    options: phoneOptions,
    wallet: phoneWallet,
    run: (a) => {
      const m = meetings[a.meetingId];
      if (!m) return;
      const h = handlersFor(m);
      if (a.kind === "approve") h.onApprove(a.followUpId, "phone");
      else if (a.kind === "dismiss") h.onDismiss(a.followUpId, "phone");
      else h.onUndoAutopilot(a.followUpId);
    },
    onHeldResolved: resolveHeld,
  });

  return (
    <MotionProvider>
      <MeProvider me={me}>
      <div className="flex h-full">
        <Sidebar
          live={live}
          onOpenLive={openLive}
          projects={projects}
          sample={meetings[syncWithAda.id] ? { id: syncWithAda.id, title: syncWithAda.title, when: "Sample", toApprove: 0 } : null}
          account={account}
          balance={walletBalance}
          current={view.name}
          selectedMeetingId={selectedMeetingId}
          selectedProjectId={view.name === "project" ? view.id : null}
          pendingByMeeting={pendingByMeeting}
          recordings={shownRecordings}
          meetingTitles={meetingTitles}
          openActions={openActions}
          onOpenAgents={() => setView({ name: "agents" })}
          onOpenHome={() => setView({ name: "home" })}
          onOpenSearch={() => setPaletteOpen(true)}
          onOpenAsk={() => go.ask()}
          onOpenActions={go.actions}
          onOpenPeople={go.people}
          onOpenMeetings={go.meetings}
          onOpenProject={(id) => setView({ name: "project", id })}
          onNewProject={() => setNewProjectOpen(true)}
          onRenameProject={(id) => setRenaming(projects.find((p) => p.id === id) ?? null)}
          onDeleteProject={deleteProject}
          onSelectMeeting={(id) =>
            meetings[id]
              ? setView({ name: "meeting", id })
              : recordings.some((r) => r.id === id)
                ? setView({ name: "recording", id })
                : setView({ name: "placeholder", title: "This meeting", milestone: "Real meetings appear here once recording and processing land (M1–M3)." })
          }
          onNewRecording={newRecording}
          onOpenWallet={() => setView({ name: "wallet" })}
          onOpenSettings={() => setView({ name: "settings" })}
        />

        <div className="relative flex min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={viewKey} {...viewMotion} className="flex min-w-0 flex-1">
            {view.name === "meeting" && meeting && (
              <MeetingScreen
                key={`${meeting.id}-${view.name === "meeting" ? view.at ?? "" : ""}`}
                openAt={view.name === "meeting" ? view.at : undefined}
                meeting={meeting}
                sample={meeting.id === syncWithAda.id ? "made-up" : recordings.some((r) => r.id === meeting.id && r.label === "Sample") ? "fictional" : undefined}
                onNear={!!saved[meeting.id]?.onChain}
                saved={saved[meeting.id]}
                proofError={saved[meeting.id]?.onChain ? undefined : proofErrors[meeting.id]}
                dropped={saved[meeting.id]?.dropped ?? (meeting.id === syncWithAda.id ? syncWithAdaDropped : undefined)}
                me={account ? [account] : []}
                autopilotOn={autopilotOn}
                onOpenAgents={() => setView({ name: "agents" })}
                onOpenAutopilot={() => setView({ name: "settings" })}
                limits={meeting.id === syncWithAda.id ? null : limits}
                onToggleItem={(itemId) => toggleItem(meeting.id, itemId)}
                onEditItem={(itemId, fields) => editItem(meeting.id, itemId, fields)}
                originalOf={(itemId) => originalOf(meeting.id, itemId)}
                handlers={handlersFor(meeting)}
                onDelete={saved[meeting.id] ? () => removeRecording(meeting.id) : undefined}
                onOpenVerify={() =>
                  saved[meeting.id]
                    ? setVerifyId(meeting.id)
                    : meeting.id === syncWithAda.id
                      ? setSampleVerify(true)
                      : setView({ name: "placeholder", title: "Verify", milestone: "This is sample data, so there is no proof to check. Record a meeting to see real checks." })
                }
              />
            )}
            {openRecording && (
              <RecordingScreen
                key={openRecording.id}
                recording={openRecording}
                payees={openRecording.label ? samplePayees : payees}
                // A sample is a made-up call: it never takes your brief.
                brief={openRecording.label ? undefined : briefs[openRecording.project]}
                onDelete={() => removeRecording(openRecording.id)}
                onProcessed={(id, notes, proofError) => onProcessedRef.current(id, notes, proofError)}
                onOpenNotes={(id) => setView((v) => (v.name === "recording" && v.id === id ? { name: "meeting", id } : v))}
                onOpenSampleMeeting={isDesktop ? undefined : () => setView({ name: "meeting", id: syncWithAda.id })}
              />
            )}
            {view.name === "home" && (
              <HomeScreen
                live={live}
                onOpenLive={openLive}
                meetings={shownMeetings}
                recordings={shownRecordings}
                sampleId={syncWithAda.id}
                onNewRecording={newRecording}
                onOpenSample={(sampleId) => openSampleRecording(sampleId)}
                onOpenMeeting={(id) => openMeeting(id)}
                onOpenSettings={() => setView({ name: "settings" })}
                onOpenWallet={() => setView({ name: "wallet" })}
                handlersFor={handlersFor}
              />
            )}
            {openProject && (
              <ProjectScreen
                project={openProject}
                recordings={shownRecordings.filter((r) => r.project === openProject.name)}
                meetings={meetings}
                account={account}
                onToggleItem={toggleItem}
                onOpenMeeting={(id) => openMeeting(id)}
                onRecord={() => {
                  setCreatedProject(openProject.name);
                  setRecordOpen(true);
                }}
                onRename={() => setRenaming(openProject)}
                onSaveBrief={(brief, source) => saveBrief(openProject.id, brief, source)}
                onSaveCodeFolder={(folder) => saveCodeFolder(openProject.id, folder)}
                payees={payees.map((p) => p.name)}
              />
            )}
            {view.name === "wallet" && (
              <WalletScreen
                blocked={blocked}
                samplePaid={paidBySample(meetings[syncWithAda.id])}
                // Paid follow-ups are the payment history: real meetings on this Mac; the sample's in the browser preview.
                paymentsFrom={shownMeetings.filter((m) => (isDesktop ? saved[m.id] : m.id === syncWithAda.id))}
                onOpenMeeting={openMeeting}
                onOpenSettings={() => setView({ name: "settings" })}
                onResolved={resolveHeld}
                onChanged={refreshWallet}
              />
            )}
            {view.name === "settings" && (
              <ConnectNear
                onOpenPrivacy={go.privacy}
                onWalletChanged={refreshWallet}
                // Real meetings on this Mac; the browser preview has none, so it shows the sample's figure, labelled.
                spend={isDesktop ? spendOf(Object.entries(saved).filter(([id]) => !hidden[id]).map(([, s]) => s.cost)) : spendOf([syncWithAdaCost])}
                spendIsSample={!isDesktop}
              />
            )}
            {view.name === "people" && <PeopleScreen meetings={library} me={me} sampleIds={sampleIds} onOpenPerson={go.person} />}
            {view.name === "person" && (
              <PersonScreen
                personId={view.id}
                meetings={library}
                me={me}
                sampleIds={sampleIds}
                onBack={go.people}
                onOpenMeeting={openMeeting}
                onToggleItem={toggleItem}
                onAsk={go.ask}
              />
            )}
            {view.name === "ask" && (
              <AskScreen meetings={library} me={me} briefs={briefs} initialQuestion={view.question} onOpenMeeting={openMeeting} onOpenSettings={() => setView({ name: "settings" })} />
            )}
            {view.name === "meetings" && <MeetingsScreen meetings={library} recordings={shownRecordings} me={me} sampleIds={sampleIds} onOpen={(id) => openMeeting(id)} />}
            {view.name === "actions" && (
              <ActionItemsScreen
                meetings={library}
                me={me}
                onToggleItem={toggleItem}
                onEditItem={editItem}
                originalOf={originalOf}
                onOpenMeeting={openMeeting} onOpenAgents={() => setView({ name: "agents" })} />
            )}
            {view.name === "privacy" && <PrivacyScreen onBack={() => setView({ name: "settings" })} onOpenSettings={() => setView({ name: "settings" })} />}
            {view.name === "agents" && (
              <AgentsScreen meetings={isDesktop ? shownMeetings.filter((m) => saved[m.id]) : shownMeetings} onOpenMeeting={(id) => setView({ name: "meeting", id })} />
            )}
            {view.name === "search" && (
              <SearchScreen key={view.query ?? ""} meetings={shownMeetings} initialQuery={view.query} onOpen={openMeeting} />
            )}
            {view.name === "live" && <LiveScreen />}
            {view.name === "processing" && <ProcessingScreen project={view.project} seconds={view.seconds} onDone={finishProcessing} />}
            {view.name === "placeholder" && (
              <main className="flex min-w-0 flex-1 flex-col border-l border-hairline bg-raised">
                <div data-tauri-drag-region className="h-9" />
                <div className="mx-auto flex max-w-[680px] flex-1 flex-col justify-center gap-3 px-12 pb-24">
                  <h1 className="t-display m-0">{view.title}</h1>
                  <p className="t-reading m-0 text-muted">{view.milestone}</p>
                </div>
              </main>
            )}
          </m.div>
        </AnimatePresence>
        <LivePill onOpenLive={() => setView({ name: "live" })} />
        </div>
        <AnimatePresence>
          {sampleVerify && <SampleVerifySheet key="sample-verify" meeting={meetings[syncWithAda.id] ?? syncWithAda} onClose={() => setSampleVerify(false)} />}
          {verifyId && saved[verifyId] && (
            <VerifySheet
              key={verifyId}
              recordingId={verifyId}
              saved={saved[verifyId]}
              onClose={() => setVerifyId(null)}
              onUpdated={(updated) => {
                setSaved((all) => ({ ...all, [verifyId]: updated }));
                setRecordings((all) => all.map((r) => (r.id === verifyId ? { ...r, notes: serializeNotes(updated) } : r)));
              }}
              onConnect={() => {
                setVerifyId(null);
                setView({ name: "settings" });
              }}
            />
          )}
        </AnimatePresence>

        {onboarding && (
          <Onboarding
            onDone={(record) => {
              setOnboarding(false);
              if (record) setRecordOpen(true);
            }}
          />
        )}
        <AnimatePresence>
          {recordOpen && (
            <RecordSheet
              key="record"
              projects={projects}
              selectProject={createdProject}
              onNewProject={() => setNewProjectOpen(true)}
              onClose={() => setRecordOpen(false)}
              onOpenSample={openSampleRecording}
              onStarted={() => {
                setRecordOpen(false);
                setView({ name: "live" });
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {paletteOpen && (
            <CommandPalette
              key="palette"
              meetings={shownMeetings}
              recordings={shownRecordings}
              balance={walletBalance}
              sampleId={syncWithAda.id}
              onClose={() => setPaletteOpen(false)}
              onNewRecording={() => setRecordOpen(true)}
              onNewProject={() => setNewProjectOpen(true)}
              onOpenWallet={() => setView({ name: "wallet" })}
              onOpenSettings={() => setView({ name: "settings" })}
              onOpenAgents={() => setView({ name: "agents" })}
              onOpenAsk={() => go.ask()}
              onOpenPeople={go.people}
              onOpenMeeting={openMeeting}
              onOpenSearch={(query) => setView({ name: "search", query })}
            />
          )}
          {newProjectOpen && <NewProjectSheet key="new-project" existing={projects.map((p) => p.name)} payees={payees.map((p) => p.name)} onClose={() => setNewProjectOpen(false)} onCreate={createProject} />}
          {renaming && (
            <NewProjectSheet key="rename-project" existing={projects.map((p) => p.name)} initial={renaming.name} onClose={() => setRenaming(null)} onCreate={(name) => renameProject(renaming, name)} />
          )}
        </AnimatePresence>
      </div>
      <Toaster />
      <DialogHost />
      </MeProvider>
    </MotionProvider>
  );
}
