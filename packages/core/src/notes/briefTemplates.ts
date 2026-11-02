// Starting points for a project brief. A template states what you care about, not facts:
// it fills "What to watch for", empty role slots for people ("client lead", with no
// name) and a few general words for the kind of project. It never fills a name, a date,
// an amount or anything else that would have to be true about your project.

export type BriefTemplateId = "blank" | "client" | "hiring" | "fundraise" | "sales" | "standup" | "one-on-one";

export interface BriefTemplate {
  id: BriefTemplateId;
  /** The chip on "Start from". */
  label: string;
  /** A placeholder for About: shown greyed out, never saved. */
  aboutHint: string;
  /** Roles with no name: a row each, left out of the brief until you type a name. */
  roles: string[];
  /** General words for this kind of project, shown as chips you can remove. */
  words: string[];
  /** Prefilled, editable. */
  watchFor: string;
}

export const BRIEF_TEMPLATES: readonly BriefTemplate[] = [
  { id: "blank", label: "Blank", aboutHint: "", roles: [], words: [], watchFor: "" },
  {
    id: "client",
    label: "Client project",
    aboutHint: "Building … for …, launching …",
    roles: ["client lead", "decision maker", "designer", "developer"],
    words: ["scope", "milestone", "invoice", "sign-off", "change request"],
    watchFor: "Scope changes, deadlines and launch dates, sign-offs, anything we agree to pay or invoice",
  },
  {
    id: "hiring",
    label: "Hiring",
    aboutHint: "Hiring a … for …",
    roles: ["candidate", "hiring manager", "interviewer", "recruiter"],
    words: ["offer", "notice period", "references", "take-home"],
    watchFor: "Candidate decisions, offer terms and salary numbers, start dates, who sends feedback by when",
  },
  {
    id: "fundraise",
    label: "Fundraise",
    aboutHint: "Raising a … round for …",
    roles: ["investor", "co-founder", "advisor"],
    words: ["pre-seed", "SAFE", "term sheet", "valuation cap", "pro rata", "cap table", "data room"],
    watchFor: "Commitments and amounts, valuation and terms, intro asks, deck and demo deadlines, follow-ups owed to investors",
  },
  {
    id: "sales",
    label: "Sales",
    aboutHint: "Selling … to …",
    roles: ["champion", "economic buyer", "procurement", "account exec"],
    words: ["pilot", "POC", "MSA", "renewal", "seats"],
    watchFor: "Pricing and discounts, the next step and its date, blockers, who signs, pilot success criteria",
  },
  {
    id: "standup",
    label: "Team standup",
    aboutHint: "Weekly sync for …",
    roles: ["team lead", "engineer", "designer", "product manager"],
    words: ["sprint", "blocker", "release", "on-call"],
    watchFor: "Blockers and who owns unblocking them, ship dates, decisions that change the plan",
  },
  {
    id: "one-on-one",
    label: "1:1",
    aboutHint: "1:1s with …",
    roles: ["manager", "report"],
    words: ["feedback", "goals", "review"],
    watchFor: "Commitments either of you made, feedback given, goals and their dates",
  },
];

export function briefTemplate(id: BriefTemplateId | undefined): BriefTemplate {
  return BRIEF_TEMPLATES.find((t) => t.id === id) ?? BRIEF_TEMPLATES[0];
}
