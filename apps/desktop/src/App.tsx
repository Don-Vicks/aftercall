import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { UNDO_SECONDS, autopilotDecision, type FollowUp, type Meeting, type Payee, type PayeeDestination, type WalletLimits } from "@aftercall/core";
import { loadRules } from "./autopilot";
import { Sidebar } from "./Sidebar";
import { MeetingScreen } from "./MeetingScreen";
import { ProcessingScreen } from "./ProcessingScreen";
import { RecordSheet } from "./recording/RecordSheet";
import { LivePill } from "./recording/LivePill";
import { LiveScreen } from "./recording/LiveScreen";
import { getSession, openNotes, pressRecordShortcut, useRecordShortcut, useRecordingEvents, useRecordingSession } from "./recording/session";
import { warnAway } from "./recording/notify";
import { syncWithAda, syncWithAdaCost, syncWithAdaDropped } from "./sample";
import { spendOf } from "./costs";
import { isDesktop, recorder, type SavedRecording } from "./recorder";
import { RecordingScreen } from "./RecordingScreen";
import { parseNotes, serializeNotes, type SavedNotes } from "./nearai";
import { ConnectNear } from "./ConnectNear";
import { VerifySheet } from "./VerifySheet";
import { HomeScreen } from "./HomeScreen";
import { SearchScreen } from "./SearchScreen";
import { WalletScreen, type BlockedPayment } from "./WalletScreen";
import { near } from "./near";
import { recordingFiles } from "./nearai";
import { claimedAccounts, confirmClaim, createClaim, draftInMail, pay, payCrossChain, previewCrossChain, sendRecap, waitingForClaims, type Patch } from "./followUpActions";
import { payees as samplePayees } from "./sample";
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
  const [view, setView] = useState<View>({ name: "home" });
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
  /**
   * From the agent-wallet contract once NEAR is connected; none until then, so a real
   * call's transcription and notes never hear the sample's names. Samples (and the
   * browser preview) use the sample payees instead.
   */
  const [payees, setPayees] = useState<Payee[]>(isDesktop ? [] : samplePayees);
  const [limits, setLimits] = useState<WalletLimits | null>(null);
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
    if (projects.length === 1) {
      toast({ text: "Keep at least one project. Rename this one instead.", tone: "caution" });
      return;
    }
    const target = projects.find((x) => x.id !== id && x.name === "General") ?? projects.find((x) => x.id !== id)!;
    const count = recordings.filter((r) => r.project === p.name).length;
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      body: count ? `Its ${count} ${count === 1 ? "meeting moves" : "meetings move"} to “${target.name}”.` : undefined,
      confirmLabel: "Delete project",
      tone: "danger",
    });
    if (!ok) return;
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

  const createProject = async (name: string) => {
    const next = [...projects, { id: projectId(name), name }];
    await projectsApi.save(next);
    setProjects(next);
    setCreatedProject(name);
    setNewProjectOpen(false);
  };

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
  const leftToday = limits?.leftToday ?? null;

  const refreshWallet = useCallback(async () => {
    const config = isDesktop ? await near.getConfig().catch(() => null) : null;
    setAccount(config?.account ?? null);
    if (!config) return;
    try {
      const v = await near.wallet();
      setBalance(v.wallet ? BigInt(v.wallet.balance) : null);
      setPayees(v.payees.map((p) => ({ name: p.label, account: p.account })));
      setDestinations(Object.fromEntries((v.destinations ?? []).map((d) => [d.payee, { chain: d.chain, address: d.address }])));
      if (v.wallet) {
        const today = Math.floor(Date.now() / 86_400_000);
        const spent = v.wallet.day === today ? BigInt(v.wallet.spent_today) : 0n;
        const cap = BigInt(v.wallet.daily_cap);
        setLimits({ leftToday: cap > spent ? cap - spent : 0n, perPaymentCap: BigInt(v.wallet.per_payment_cap) });
      }
    } catch {
      // Offline or not set up: keep what we have.
    }
  }, []);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  // Recordings that have notes open as meetings.
  const addProcessed = (list: SavedRecording[]) => {
    const processed: Record<string, Meeting> = {};
    const notes: Record<string, SavedNotes> = {};
    for (const r of list) {
      if (!r.notes) continue;
      try {
        notes[r.id] = parseNotes(r.notes);
        processed[r.id] = notes[r.id].meeting;
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

  /** notes.json as last read from disk, by id, to spot changes made outside the app (agents, via the MCP server). */
  const diskNotes = useRef<Record<string, string>>({});

  /** Takes notes.json from disk as the truth for one meeting. */
  const applyDiskNotes = (id: string, notes: string) => {
    diskNotes.current[id] = notes;
    setRecordings((all) => all.map((r) => (r.id === id ? { ...r, notes } : r)));
    addProcessed([{ id, notes } as SavedRecording]);
  };

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
      .catch(() => setRecordings([]));
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

  /** Changes one follow-up and, for real meetings, saves it to the meeting's notes.json. */
  const patchFollowUp = (meetingId: string, fuId: string, patch: Patch) => {
    setMeetings((all) => {
      const m = all[meetingId];
      const next = { ...m, followUps: m.followUps.map((f) => (f.id === fuId ? ({ ...f, ...patch } as FollowUp) : f)) };
      const notes = saved[meetingId];
      if (notes) {
        const updated = { ...notes, meeting: next };
        setSaved((s) => ({ ...s, [meetingId]: updated }));
        recordingFiles.saveNotes(meetingId, serializeNotes(updated)).catch(() => {});
      }
      return { ...all, [meetingId]: next };
    });
  };

  const handlersFor = (meeting: Meeting) => {
    const find = (id: string) => meeting.followUps.find((f) => f.id === id)!;
    const apply = (id: string) => (patch: Patch) => patchFollowUp(meeting.id, id, patch);
    const sample = meeting.id === syncWithAda.id;
    return {
      onApprove: (id: string) => {
        const f = find(id);
        if (sample) {
          // The sample meeting only simulates the round trip.
          apply(id)({ status: "sending" });
          setTimeout(() => apply(id)({ status: f.kind === "email" ? "sent" : "paid", doneAt: nowHHMM() }), 1600);
          return;
        }
        if (f.kind === "email") sendRecap(meeting, f, apply(id), saved[meeting.id]);
        else if (destinations[f.payeeAccount]) payCrossChain(meeting, f, destinations[f.payeeAccount], apply(id)).then(refreshWallet);
        else pay(meeting, f, apply(id)).then(refreshWallet);
      },
      routeFor: (f: FollowUp) => (sample || f.kind !== "payment" ? null : (destinations[f.payeeAccount] ?? null)),
      previewRoute: previewCrossChain,
      onDismiss: (id: string) => apply(id)({ status: "dismissed", autopilotAt: undefined }),
      onRestore: (id: string, status: FollowUp["status"]) => apply(id)({ status }),
      onUndoAutopilot: (id: string) => apply(id)({ autopilotAt: undefined }),
      onSetAmount: (id: string, amount: bigint) => apply(id)({ amount, autopilotAt: undefined, error: undefined }),
      onReviewBlocked: () => setView({ name: "wallet" }),
      onDraft: (id: string) => {
        const f = find(id);
        if (f.kind !== "email") return;
        if (!isDesktop) return void toast({ text: "In the Mac app this opens the recap as a draft in Mail. The browser preview can't." });
        // The sample never went to NEAR AI, so a footer about checks and deleted audio would be untrue.
        if (sample) return void toast({ text: "The sample meeting is made up, so it has no recap to draft. Record a call to draft one in Mail." });
        draftInMail(meeting, f, saved[meeting.id])
          .then(() => apply(id)({ draftedAt: nowHHMM(), autopilotAt: undefined }))
          .catch((e) => toast({ text: `Couldn't open Mail: ${e instanceof Error ? e.message : String(e)}`, tone: "record" }));
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
    };
  };

  /** Queues what autopilot may do in a freshly processed meeting, each with an undo window. */
  const scheduleAutopilot = (m: Meeting) => {
    const rules = loadRules();
    const at = Date.now() + UNDO_SECONDS * 1000;
    for (const f of m.followUps) {
      // A payment on another chain needs a fresh quote the person has seen: never autopilot.
      if (f.kind === "payment" && destinations[f.payeeAccount]) continue;
      if (autopilotDecision(f, rules, limits).run) patchFollowUp(m.id, f.id, { autopilotAt: at });
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
          if (!autopilotDecision(f, loadRules(), limits).run) continue;
          if (f.kind === "payment" && destinations[f.payeeAccount]) continue;
          // Marked as autopilot's only once it went out, so a later manual approval isn't credited to it.
          const apply = (patch: Patch) => patchFollowUp(m.id, f.id, patch.status === "sent" || patch.status === "paid" ? { ...patch, byAutopilot: true } : patch);
          if (f.kind === "email") sendRecap(m, f, apply, saved[m.id]);
          else pay(m, f, apply).then(refreshWallet);
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

  const blocked: BlockedPayment[] = meetingList
    .filter((m) => saved[m.id] && !hidden[m.id])
    .flatMap((m) => m.followUps.filter((f) => f.kind === "payment" && f.status === "blocked").map((f) => ({ meeting: m, followUp: f as BlockedPayment["followUp"] })));

  const finishProcessing = useCallback(() => setView({ name: "meeting", id: syncWithAda.id }), []);

  const pendingByMeeting = Object.fromEntries(
    Object.values(meetings).map((m) => [m.id, m.followUps.filter((f) => f.status === "proposed").length]),
  );

  const selectedMeetingId = view.name === "meeting" || view.name === "recording" ? view.id : null;
  // Processing can finish after the user has left the recording, so this reads
  // the latest state instead of the closure the run started with.
  const onProcessedRef = useRef((_id: string, _notes: string) => {});
  onProcessedRef.current = (id, notes) => {
    const recording = recordings.find((r) => r.id === id);
    if (!recording) return;
    const updated = { ...recording, notes };
    setRecordings((all) => all.map((r) => (r.id === id ? updated : r)));
    addProcessed([updated]);
    setView((v) => (v.name === "recording" && v.id === id ? { name: "meeting", id } : v));
    const processed = parseNotes(notes).meeting;
    setTimeout(() => scheduleAutopilot(processed), 0);
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
  const shownMeetings = meetingList.filter((m) => !hidden[m.id]);
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
          balance={balance}
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
                dropped={saved[meeting.id]?.dropped ?? (meeting.id === syncWithAda.id ? syncWithAdaDropped : undefined)}
                me={account ? [account] : []}
                autopilotOn={autopilotOn}
                onOpenAgents={() => setView({ name: "agents" })}
                onOpenAutopilot={() => setView({ name: "settings" })}
                leftToday={meeting.id === syncWithAda.id ? null : leftToday}
                onToggleItem={(itemId) => toggleItem(meeting.id, itemId)}
                handlers={handlersFor(meeting)}
                onDelete={saved[meeting.id] ? () => removeRecording(meeting.id) : undefined}
                onOpenVerify={() =>
                  saved[meeting.id]
                    ? setVerifyId(meeting.id)
                    : setView({ name: "placeholder", title: "Verify", milestone: "This is sample data, so there is no proof to check. Record a meeting to see real checks." })
                }
              />
            )}
            {openRecording && (
              <RecordingScreen
                key={openRecording.id}
                recording={openRecording}
                payees={openRecording.label ? samplePayees : payees}
                onDelete={() => removeRecording(openRecording.id)}
                onProcessed={(id, notes) => onProcessedRef.current(id, notes)}
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
              />
            )}
            {view.name === "wallet" && (
              <WalletScreen
                blocked={blocked}
                onOpenSettings={() => setView({ name: "settings" })}
                onResolved={(meetingId, fuId, status) => {
                  patchFollowUp(meetingId, fuId, { status, doneAt: status === "paid" ? nowHHMM() : undefined });
                  refreshWallet();
                }}
                onChanged={refreshWallet}
              />
            )}
            {view.name === "settings" && (
              <ConnectNear
                onOpenPrivacy={go.privacy}
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
              <AskScreen meetings={library} me={me} initialQuestion={view.question} onOpenMeeting={openMeeting} onOpenSettings={() => setView({ name: "settings" })} />
            )}
            {view.name === "meetings" && <MeetingsScreen meetings={library} recordings={shownRecordings} me={me} sampleIds={sampleIds} onOpen={(id) => openMeeting(id)} />}
            {view.name === "actions" && (
              <ActionItemsScreen meetings={library} me={me} onToggleItem={toggleItem} onOpenMeeting={(id) => openMeeting(id)} onOpenAgents={() => setView({ name: "agents" })} />
            )}
            {view.name === "privacy" && <PrivacyScreen onBack={() => setView({ name: "settings" })} onOpenSettings={() => setView({ name: "settings" })} />}
            {view.name === "agents" && (
              <AgentsScreen meetings={shownMeetings.filter((m) => saved[m.id])} onOpenMeeting={(id) => setView({ name: "meeting", id })} />
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
              balance={balance}
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
          {newProjectOpen && <NewProjectSheet key="new-project" existing={projects.map((p) => p.name)} onClose={() => setNewProjectOpen(false)} onCreate={createProject} />}
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
