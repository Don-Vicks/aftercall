import { useEffect, useState } from "react";
import { calendar, type CalendarStatus } from "./calendar";
import { isDesktop } from "./recorder";
import { Button, Pill, SectionLabel, Spinner } from "./ui";

/** The Calendar section of Settings: optional, read-only access to the macOS calendar. */
export function CalendarSettings() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    calendar.status().then(setStatus).catch(() => setStatus("denied"));
  }, []);

  const connect = async () => {
    setAsking(true);
    await calendar.requestAccess().catch(() => false);
    setStatus(await calendar.status().catch(() => "denied" as const));
    setAsking(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Calendar</SectionLabel>
      <p className="m-0 text-muted">
        Names each recording after the calendar event it overlaps and fills in recap addresses from the invite. Aftercall only reads your calendar, on this Mac.
      </p>
      <div className="flex items-center justify-between gap-4 rounded-md px-5 py-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
        <span className="flex flex-col gap-0.5">
          <span className="t-title">macOS Calendar</span>
          <span className="text-muted">
            {!isDesktop
              ? "Works in the Mac app, not the browser preview."
              : status === "denied"
                ? "No access. Turn it on in System Settings → Privacy & Security → Calendars."
                : status === "granted"
                  ? "Meeting names and recap addresses come from your calendar."
                  : "Not connected. Recordings are named by their start time."}
          </span>
        </span>
        {status === "granted" && <Pill tone="verdigris">Connected</Pill>}
        {status === "not-asked" && isDesktop && (
          <Button variant="primary" disabled={asking} onClick={connect}>
            {asking && <Spinner size={12} />}
            Connect calendar
          </Button>
        )}
      </div>
    </section>
  );
}
