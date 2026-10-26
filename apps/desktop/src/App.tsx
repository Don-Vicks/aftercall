import { useCallback, useEffect, useState } from "react";
import type { Meeting } from "@aftercall/core";
import { Sidebar } from "./Sidebar";
import { MeetingScreen } from "./MeetingScreen";
import { ProcessingScreen } from "./ProcessingScreen";
import { RecordPanel } from "./RecordPanel";
import { syncWithAda } from "./sample";

type View =
  | { name: "meeting"; id: string }
  | { name: "processing"; project: string; seconds: number }
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRecordOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    setFollowUpStatus(meetingId, fuId, "sending");
    setTimeout(() => setFollowUpStatus(meetingId, fuId, fu.kind === "email" ? "sent" : "paid", nowHHMM()), 1600);
  };

  const finishProcessing = useCallback(() => setView({ name: "meeting", id: syncWithAda.id }), []);

  const pendingByMeeting = Object.fromEntries(
    Object.values(meetings).map((m) => [m.id, m.followUps.filter((f) => f.status === "proposed").length]),
  );

  const selectedMeetingId = view.name === "meeting" ? view.id : null;
  const meeting = selectedMeetingId ? meetings[selectedMeetingId] : undefined;

  return (
    <div className="flex h-full">
      <Sidebar
        selectedMeetingId={selectedMeetingId}
        pendingByMeeting={pendingByMeeting}
        onSelectMeeting={(id) =>
          meetings[id]
            ? setView({ name: "meeting", id })
            : setView({ name: "placeholder", title: "This meeting", milestone: "Real meetings appear here once recording and processing land (M1–M3)." })
        }
        onNewRecording={() => setRecordOpen(true)}
        onOpenWallet={() => setView({ name: "placeholder", title: "Agent wallet", milestone: "Deposit, caps and payees arrive with the contract on testnet (M4)." })}
        onOpenSettings={() => setView({ name: "placeholder", title: "Settings", milestone: "Settings arrive with onboarding and recovery (M5)." })}
      />

      {view.name === "meeting" && meeting && (
        <MeetingScreen
          key={meeting.id}
          meeting={meeting}
          onToggleItem={(itemId) => toggleItem(meeting.id, itemId)}
          onApprove={(fuId) => approve(meeting.id, fuId)}
          onDismiss={(fuId) => setFollowUpStatus(meeting.id, fuId, "dismissed")}
          onOpenVerify={() => setView({ name: "placeholder", title: "Verify", milestone: "The five proof checks arrive with record_proof on testnet (M3)." })}
          onReviewBlocked={() => setView({ name: "placeholder", title: "Approve in your wallet", milestone: "Over-cap approvals in your own wallet arrive in M4." })}
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
          onStop={(project, seconds) => {
            setRecordOpen(false);
            setView({ name: "processing", project, seconds });
          }}
        />
      )}
    </div>
  );
}
