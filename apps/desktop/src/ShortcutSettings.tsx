import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { isDesktop, recorder, type ShortcutStatus } from "./recorder";
import { Card, SectionTitle, Toggle, toast } from "./ui";
import { CardRow, IconDisc, Why, errorText } from "./SettingsParts";

const TAKEN = "Another app already uses ⌘⇧R, so it works only in Aftercall's window.";

/**
 * The Shortcut section of Settings: ⌘⇧R from any app (the default) or only inside
 * Aftercall, so other apps keep it. The browser preview switches it in memory.
 */
export function ShortcutSettings() {
  const [status, setStatus] = useState<ShortcutStatus | null>(isDesktop ? null : { wanted: true, registered: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    recorder
      .shortcutStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  const change = async (on: boolean) => {
    if (!isDesktop) return setStatus({ wanted: on, registered: on });
    setBusy(true);
    try {
      const s = await recorder.setShortcutEverywhere(on);
      setStatus(s);
      // The switch reads "on" either way; a toast is announced, the row's detail isn't.
      if (on && !s.registered) toast({ text: TAKEN, tone: "caution" });
    } catch (e) {
      toast({ text: `Couldn't change the shortcut: ${errorText(e)}`, tone: "record" });
    } finally {
      setBusy(false);
    }
  };

  // You want it everywhere, but another app already had ⌘⇧R when Aftercall asked.
  const taken = Boolean(status?.wanted && !status.registered);

  return (
    <section aria-labelledby="h-shortcut" className="flex flex-col gap-3">
      <SectionTitle id="h-shortcut">Shortcut</SectionTitle>
      <Card pad="none">
        <CardRow
          icon={
            <IconDisc tone="well">
              <Keyboard size={16} strokeWidth={1.75} />
            </IconDisc>
          }
          title="⌘⇧R from any app"
          detail={
            // Nothing until the Mac app says what is in force, so an "off" never flashes as "on".
            !status
              ? undefined
              : taken
                ? `${TAKEN} Quit that app, then turn this off and on again.`
                : status.wanted
                  ? "Open the record sheet, or your notes while recording, from any app. While Aftercall runs, other apps can't use ⌘⇧R."
                  : "Off. ⌘⇧R works only in Aftercall's window, and other apps keep it."
          }
        >
          <Toggle aria-label="⌘⇧R from any app" checked={status?.wanted ?? false} disabled={busy || !status} onChange={change} />
        </CardRow>
      </Card>
      <Why>
        macOS gives a shortcut to one app at a time. While this is on, other apps don't get ⌘⇧R: Safari's Reader view, for example. The menu bar item
        records from anywhere either way.
      </Why>
    </section>
  );
}
