import type { Meeting } from "../meeting.ts";
import { matchPayee, type Payee } from "./build.ts";

/**
 * Matches a meeting's waiting payments against the payee list as it is now, with the
 * rule `buildMeeting` uses: a payment heard before its payee was added becomes "on
 * your list", and one whose payee was removed stops being. Only proposed payments
 * change, and not one autopilot has queued; sending, paid, blocked, failed and
 * dismissed ones keep what they had. Returns the same meeting when nothing changed.
 */
export function rematchPayees(meeting: Meeting, payees: Payee[]): Meeting {
  let changed = false;
  const followUps = meeting.followUps.map((f) => {
    if (f.kind !== "payment" || f.status !== "proposed" || f.autopilotAt) return f;
    // The account it already has first, so a renamed payee still matches; then the name heard.
    const payee = matchPayee(payees, f.payeeAccount || null) ?? matchPayee(payees, f.payeeName);
    const payeeName = payee?.name ?? f.payeeName;
    const payeeAccount = payee?.account ?? "";
    const payeeListed = !!payee;
    if (payeeName === f.payeeName && payeeAccount === f.payeeAccount && payeeListed === f.payeeListed) return f;
    changed = true;
    return { ...f, payeeName, payeeAccount, payeeListed };
  });
  return changed ? { ...meeting, followUps } : meeting;
}
