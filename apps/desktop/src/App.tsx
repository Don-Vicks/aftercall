import { useCallback, useEffect, useState } from "react";
import type { Meeting } from "@aftercall/core";
import { Sidebar } from "./Sidebar";
import { MeetingScreen } from "./MeetingScreen";
import { ProcessingScreen } from "./ProcessingScreen";
import { RecordPanel } from "./RecordPanel";
import { syncWithAda } from "./sample";
import { isDesktop, recorder, type SavedRecording } from "./recorder";
import { RecordingScreen } from "./RecordingScreen";
import { parseNotes, serializeNotes, type SavedNotes } from "./nearai";
import { ConnectNear } from "./ConnectNear";
import { VerifySheet } from "./VerifySheet";

type View =
  | { name: "meeting"; id: string }
  | { name: "processing"; project: string; seconds: number }
  | { name: "recording"; id: string }
  | { name: "settings" }
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
  const [view, setView] = useState<View>({ name: "meeting", id: syncWithAda.id });
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  /** notes.json of processed recordings, by id: the proof and checks behind each meeting. */
  const [saved, setSaved] = useState<Record<string, SavedNotes>>({});
  const [verifyId, setVerifyId] = useState<string | null>(null);

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

  // Saved recordings from earlier sessions.
  useEffect(() => {
    if (!isDesktop) return;
    recorder
      .list()
      .then((list) => {
        setRecordings(list);
        addProcessed(list);
      })
      .catch(() => setRecordings([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRecordOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    // "New recording…" in the menu bar item opens the panel.
    const offMenu = isDesktop ? recorder.onMenuNewRecording(() => setRecordOpen(true)) : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      offMenu?.then((f) => f());
    };
  }, []);

  const update = (id: string, fn: (m: Meeting) => Meeting) => setMeetings((all) => ({ ...all, [id]: fn(all[id]) }));

  const toggleItem = (meetingId: string, itemId: string) =>
    update(meetingId, (m) => ({ ...m, actionItems: m.actionItems.map((a) => (a.id === itemId ? { ...a, done: !a.done } : a)) }));

  const setFollowUpStatus = (meetingId: string, fuId: string, status: Meeting["followUps"][number]["status"], doneAt?: string) =>
    update(meetingId, (m) => ({ ...m, followUps: m.followUps.map((f) => (f.id === fuId ? { ...f, status, doneAt } : f)) }));

  // Until the contract and email service are wired (M4), approving simulates the round trip.
  const approve = (meetingId: string, fuId: string) => {
    const fu = meetings[meetingId].followUps.find((f) => f.id === fuId);
    if (!fu) return;
    // On real notes nothing is faked: sending and paying arrive with M4.
    if (meetingId !== syncWithAda.id) {
      setView({
        name: "placeholder",
        title: fu.kind === "email" ? "Sending the recap" : "Paying from your agent wallet",
        milestone: `Nothing was sent. ${fu.kind === "email" ? "Email follow-ups" : "Payments under your contract's caps"} arrive in M4.`,
      });
      return;
    }
    setFollowUpStatus(meetingId, fuId, "sending");
    setTimeout(() => setFollowUpStatus(meetingId, fuId, fu.kind === "email" ? "sent" : "paid", nowHHMM()), 1600);
  };

  const finishProcessing = useCallback(() => setView({ name: "meeting", id: syncWithAda.id }), []);

  const pendingByMeeting = Object.fromEntries(
    Object.values(meetings).map((m) => [m.id, m.followUps.filter((f) => f.status === "proposed").length]),
  );

  const selectedMeetingId = view.name === "meeting" || view.name === "recording" ? view.id : null;
  const openRecording = view.name === "recording" ? recordings.find((r) => r.id === view.id) : undefined;
  const meetingTitles = Object.fromEntries(Object.values(meetings).map((m) => [m.id, m.title]));
  const meeting = selectedMeetingId ? meetings[selectedMeetingId] : undefined;

  return (
    <div className="flex h-full">
      <Sidebar
        selectedMeetingId={selectedMeetingId}
        pendingByMeeting={pendingByMeeting}
        recordings={recordings}
        meetingTitles={meetingTitles}
        onSelectMeeting={(id) =>
          meetings[id]
            ? setView({ name: "meeting", id })
            : recordings.some((r) => r.id === id)
              ? setView({ name: "recording", id })
              : setView({ name: "placeholder", title: "This meeting", milestone: "Real meetings appear here once recording and processing land (M1–M3)." })
        }
        onNewRecording={() => setRecordOpen(true)}
        onOpenWallet={() => setView({ name: "placeholder", title: "Agent wallet", milestone: "Deposit, caps and payees arrive with the contract on testnet (M4)." })}
        onOpenSettings={() => setView({ name: "settings" })}
      />

      {view.name === "meeting" && meeting && (
        <MeetingScreen
          key={meeting.id}
          meeting={meeting}
          onToggleItem={(itemId) => toggleItem(meeting.id, itemId)}
          onApprove={(fuId) => approve(meeting.id, fuId)}
          onDismiss={(fuId) => setFollowUpStatus(meeting.id, fuId, "dismissed")}
          onOpenVerify={() =>
            saved[meeting.id]
              ? setVerifyId(meeting.id)
              : setView({ name: "placeholder", title: "Verify", milestone: "This is sample data, so there is no proof to check. Record a meeting to see real checks." })
          }
          onReviewBlocked={() => setView({ name: "placeholder", title: "Approve in your wallet", milestone: "Over-cap approvals in your own wallet arrive in M4." })}
        />
      )}
      {openRecording && (
        <RecordingScreen
          key={openRecording.id}
          recording={openRecording}
          onProcessed={(notes) => {
            const updated = { ...openRecording, notes };
            setRecordings((all) => all.map((r) => (r.id === updated.id ? updated : r)));
            addProcessed([updated]);
            setView({ name: "meeting", id: updated.id });
          }}
        />
      )}
      {view.name === "settings" && <ConnectNear />}
      {verifyId && saved[verifyId] && (
        <VerifySheet
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

      {recordOpen && (
        <RecordPanel
          onClose={() => setRecordOpen(false)}
          onStop={(project, seconds, saved) => {
            setRecordOpen(false);
            if (saved) {
              // A real recording: show it as its own meeting, with its true status.
              setRecordings((all) => [saved, ...all.filter((r) => r.id !== saved.id)]);
              setView({ name: "recording", id: saved.id });
            } else {
              // Browser preview: walk through the simulated pipeline on sample data.
              setView({ name: "processing", project, seconds });
            }
          }}
        />
      )}
    </div>
  );
}
