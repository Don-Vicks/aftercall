import { useEffect, useState } from "react";
import { Calendar, Check } from "lucide-react";
import { calendar, type CalendarStatus } from "./calendar";
import { isDesktop } from "./recorder";
import { Button, Card, Pill, SectionTitle } from "./ui";
import { CardRow, IconDisc, Pop, Why } from "./SettingsParts";

/**
 * The Calendar section of Settings: optional, read-only access to the macOS calendar.
 * `onChange` hears the access state, for the section index.
 */
export function CalendarSettings({ onChange }: { onChange?: (status: CalendarStatus) => void }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [asking, setAsking] = useState(false);

  const update = (s: CalendarStatus) => {
    setStatus(s);
    onChange?.(s);
  };

  useEffect(() => {
    calendar
      .status()
      .then(update)
      .catch(() => update("denied"));
  }, []);

  const connect = async () => {
    setAsking(true);
    await calendar.requestAccess().catch(() => false);
    update(await calendar.status().catch(() => "denied" as const));
    setAsking(false);
  };

  return (
    <section aria-labelledby="h-calendar" className="flex flex-col gap-3">
      <SectionTitle id="h-calendar" count="optional">
        Calendar
      </SectionTitle>
      <Card pad="none">
        <CardRow
          icon={
            <IconDisc tone="well">
              <Calendar size={16} strokeWidth={1.75} />
            </IconDisc>
          }
          title="macOS Calendar"
          detail={
            !isDesktop
              ? "Works in the Mac app, not the browser preview."
              : status === "denied"
                ? "No access. Turn it on in System Settings → Privacy & Security → Calendars."
                : status === "granted"
                  ? "Meeting names and recap addresses come from your calendar."
                  : "Not connected. Recordings are named by their start time."
          }
        >
          <Pop show={status === "granted"}>
            <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
              Connected
            </Pill>
          </Pop>
          {status === "not-asked" && isDesktop && (
            <Button variant="primary" loading={asking} onClick={connect}>
              Connect calendar
            </Button>
          )}
        </CardRow>
      </Card>
      <Why>
        Each recording is named after the calendar event it overlaps, and recap addresses come from the invite. Aftercall only reads your calendar, on this Mac.
      </Why>
    </section>
  );
}
