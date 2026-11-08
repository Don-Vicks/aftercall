import { useEffect, useState } from "react";
import { Hash, ShieldCheck } from "lucide-react";
import { slackWebhookProblem } from "@aftercall/core";
import { isDesktop } from "./recorder";
import { slackWebhook } from "./slack";
import { CardRow, IconDisc, Why, errorText } from "./SettingsParts";
import { LinkButton } from "./SetupAssistant";
import { Button, Card, Field, Input, Pill, SectionTitle, useConfirm } from "./ui";

/** Slack's own guide to making an incoming webhook for a channel. */
const WEBHOOK_GUIDE_URL = "https://api.slack.com/messaging/webhooks";

/**
 * Slack: paste an incoming webhook, and recap cards offer Post to Slack. The webhook goes
 * to the Keychain through Rust and is never shown again, only that one is set.
 * `onChange` hears whether one is saved, for the section index.
 */
export function SlackSettings({ onChange }: { onChange?: (connected: boolean) => void }) {
  const [connected, setConnected] = useState<boolean | null>(isDesktop ? null : false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const on = isDesktop ? await slackWebhook.has().catch(() => false) : false;
    setConnected(on);
    onChange?.(on);
  };
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    const problem = slackWebhookProblem(url);
    if (problem) return setError(problem);
    setError(null);
    setSaving(true);
    try {
      await slackWebhook.set(url);
      setUrl("");
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const confirm = useConfirm();
  const disconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Slack?",
      body: "Aftercall removes the webhook from your Keychain, and recaps stop offering Post to Slack. What was posted stays in Slack.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await slackWebhook.clear();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section aria-labelledby="h-slack" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id="h-slack" count="recaps to a channel">
          Slack
        </SectionTitle>
        <p className="m-0 text-ink-2">
          Post a recap to one Slack channel. Posts go to the channel the webhook was made for, and Slack keeps them there. Aftercall sends nothing to Slack until you
          tap Post to Slack on a recap.
        </p>
      </div>
      {connected === null ? null : connected ? (
        <Card pad="none">
          <CardRow
            icon={
              <IconDisc tone="verdigris">
                <Hash size={16} strokeWidth={1.75} />
              </IconDisc>
            }
            title="Incoming webhook"
            detail="Set, in your Keychain. Recaps offer Post to Slack."
          >
            <Pill tone="verdigris" icon={<ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />}>
              Connected
            </Pill>
            <Button variant="quiet" onClick={disconnect}>
              Disconnect
            </Button>
          </CardRow>
          {error && <p className="selectable m-0 px-5 pb-4 text-[13px] leading-[19px] text-record">{error}</p>}
        </Card>
      ) : (
        <Card pad="md">
          <div className="flex flex-col gap-3">
            <Field label="Slack incoming webhook" error={error} hint="Make one for the channel recaps should go to, then paste its URL here.">
              <div className="flex gap-2">
                <Input
                  mono
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && url.trim() && !saving && isDesktop && save()}
                  placeholder="https://hooks.slack.com/services/…"
                  className="flex-1"
                />
                <Button variant="primary" loading={saving} disabled={!url.trim() || !isDesktop} onClick={save}>
                  {saving ? "Saving…" : "Connect"}
                </Button>
              </div>
            </Field>
            {!isDesktop && <p className="m-0 text-[13px] leading-[19px] text-ink-2">Connecting works in the Mac app, not the browser preview.</p>}
            <LinkButton href={WEBHOOK_GUIDE_URL}>How to make a webhook</LinkButton>
          </div>
        </Card>
      )}
      <Why>
        The webhook is kept in your macOS Keychain, out of the app's window, and Aftercall never shows it again; whoever has it can post to that channel. A post holds the
        recap's text: the summary, decisions, action items and the footer, never the transcript or the audio. Autopilot, your paired phone and coding agents can't post.
      </Why>
    </section>
  );
}
