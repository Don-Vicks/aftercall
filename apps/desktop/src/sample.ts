import { estimateCost, type Dropped, type Meeting } from "@aftercall/core";

/**
 * Sample data for building the interface before the capture and summary pipeline
 * exist (M1–M2). Nothing here is sent anywhere; it is replaced by real meetings
 * once transcription and summaries run in NEAR AI.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  meetingCount: number;
  meetings: { id: string; title: string; when: string; toApprove?: number }[];
}

export const projects: ProjectSummary[] = [
  {
    id: "fundraise",
    name: "Fundraise",
    meetingCount: 6,
    meetings: [
      { id: "sync-ada", title: "Sync with Ada", when: "Today", toApprove: 1 },
      { id: "deck-review", title: "Deck review", when: "3 Nov" },
      { id: "investor-intro", title: "Investor intro call", when: "2 Nov" },
    ],
  },
  { id: "platform", name: "Platform API", meetingCount: 11, meetings: [] },
  { id: "hiring", name: "Hiring", meetingCount: 3, meetings: [] },
];

export const account = "victor.near";

/** Payee list until payees come from the agent-wallet contract (M4). */
export const payees = [{ name: "Designer", account: "designer.near" }];
export const walletBalance = 180_000_000n; // 180.00 USDC
export const dailyCap = 200_000_000n; // 200.00 USDC
export const spentToday = 50_000_000n;

/** Today at hh:mm, as an ISO time (when the sample's agent claimed its item). */
function todayAt(h: number, m: number): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export const syncWithAda: Meeting = {
  id: "sync-ada",
  project: "Fundraise",
  title: "Sync with Ada",
  startedAt: "Today 14:02",
  durationSec: 192,
  verified: true,
  summary:
    "Ada and Victor agreed the API fix ships before Friday's demo. Victor sends Ada a recap today and pays the designer a 50 USDC deposit to refresh the deck.",
  yourNotes: "Fix before demo, no exceptions.\nDeck: refresh with the designer, deposit now, rest when it's done.",
  attendees: [{ name: "Ada", email: "ada@example.com" }],
  invited: [{ name: "Ada", email: "ada@example.com" }],
  decisions: [
    "Ship the API fix before Friday's demo.",
    "Refresh the deck with the designer, with a 50 USDC deposit now.",
  ],
  actionItems: [
    { id: "a1", text: "Send Ada the recap", owner: "You", due: "today", done: false },
    { id: "a2", text: "Ship the API fix", owner: "You", due: "by Friday", done: false, claimed: { agent: "Claude Code", at: todayAt(14, 20) } },
    {
      id: "a3",
      text: "Get deck feedback from Ada",
      owner: "You",
      done: true,
      closedNote: "Closed here · opened in Deck review, 3 Nov",
    },
  ],
  followUps: [
    {
      id: "f1",
      kind: "email",
      status: "sent",
      doneAt: "14:06",
      to: "ada@example.com",
      toName: "Ada",
      subject: "Recap: API fix before Friday, deck refresh",
      evidence: { quote: "Send Ada the recap after this call", at: 134 },
    },
    {
      id: "f2",
      kind: "payment",
      status: "proposed",
      payeeName: "Designer",
      payeeAccount: "designer.near",
      amount: 50_000_000n,
      heard: "fifty dollar",
      payeeListed: true,
      evidence: { quote: "pay the designer the fifty dollar deposit today", at: 134 },
    },
    {
      id: "f3",
      kind: "payment",
      status: "blocked",
      payeeName: "Designer",
      payeeAccount: "designer.near",
      amount: 5_000_000_000n,
      heard: "five thousand",
      payeeListed: true,
      evidence: { quote: "the full five thousand when the deck is done", at: 150 },
    },
  ],
  transcript: [
    { at: 4, speaker: "you", text: "Hi team, thanks for jumping on. Quick one today, I mainly want to agree on Friday." },
    { at: 31, speaker: "others", text: "The API fix has to ship before the demo. If it slips, we move the demo, not the fix." },
    { at: 72, speaker: "you", text: "Your feedback on the deck was useful, I think we can close that out now." },
    {
      at: 134,
      speaker: "you",
      text: "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today.",
    },
    { at: 150, speaker: "you", text: "And the full five thousand when the deck is done." },
    { at: 160, speaker: "others", text: "Great. I'll look out for the recap. Talk Friday." },
  ],
};

/**
 * What the model proposed for the sample that the app dropped: its quote isn't in the
 * transcript, so nothing was done with it. Shows the disclosure in the browser preview.
 */
export const syncWithAdaDropped: Dropped[] = [
  { kind: "action item", text: "Book the launch venue for the demo", reason: "QUOTE_NOT_IN_TRANSCRIPT" },
];

/**
 * An estimated cost for the sample, so the browser preview can show the spend row.
 * The token counts are made up but typical: about $0.0042.
 */
export const syncWithAdaCost = estimateCost({ whisperSeconds: 384, chat: { model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 20_000, completion_tokens: 2_500 } } });
