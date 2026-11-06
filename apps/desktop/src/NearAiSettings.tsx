import { Coins, ReceiptText } from "lucide-react";
import { formatCost, typicalMeetingCost } from "@aftercall/core";
import { NearAiConnect } from "./NearAiConnect";
import { CardRow, IconDisc, Why } from "./SettingsParts";
import { LinkButton } from "./SetupAssistant";
import { aboutCost, pricesDay, type Spend } from "./costs";
import { plural } from "./library";
import { Card, SectionTitle } from "./ui";

/**
 * The NEAR AI section of Settings. `onChange` hears whether a key is saved, for the section index.
 * `spend` sums the estimated cost of the notes saved on this Mac, when any has one.
 */
export function NearAiSettings({ onChange, spend, sample }: { onChange?: (connected: boolean) => void; spend?: Spend | null; sample?: boolean }) {
  return (
    <section aria-labelledby="h-near-ai" className="flex flex-col gap-3">
      <SectionTitle id="h-near-ai" count="makes your notes">
        NEAR AI
      </SectionTitle>
      <NearAiConnect onChange={onChange} />
      <Why>
        Aftercall checks the key with NEAR AI, then keeps it in your macOS Keychain, out of the app's web view. Only NEAR AI's Confidential TEE models are used.
        What NEAR AI itself keeps is set by NEAR AI.
      </Why>
      {spend && <SpendRow spend={spend} sample={sample} />}
      <StakingCard spend={spend} sample={sample} />
    </section>
  );
}

/**
 * "About $0.03 across 7 meetings": an estimate from token counts, for the notes saved
 * here. It can't count runs that failed partway, or Ask, so it says so.
 */
function SpendRow({ spend, sample }: { spend: Spend; sample?: boolean }) {
  const about = spend.meetings > 0 ? aboutCost(spend.cost) : null;
  const total = about
    ? `${about} across ${plural(spend.meetings, "meeting")}.${spend.unknown > 0 ? ` NEAR AI didn't report the tokens for ${plural(spend.unknown, "more meeting")}.` : ""}`
    : `NEAR AI didn't report the tokens for ${spend.unknown === 1 ? "this meeting" : `these ${spend.unknown} meetings`}, so there's no estimate.`;
  return (
    <Card pad="none">
      <CardRow
        icon={
          <IconDisc>
            <ReceiptText size={16} strokeWidth={1.75} />
          </IconDisc>
        }
        title={sample ? "Estimated cost of the notes · sample" : "Estimated cost of the notes saved on this Mac"}
        detail={
          <>
            {total} Runs that failed and Ask aren't counted. From token counts and NEAR AI's public prices on {pricesDay(spend.cost.pricesAsOf)}.
          </>
        }
      />
    </Card>
  );
}

/** Where staking for NEAR AI credits starts: the organization's Credits page, after a NEAR wallet sign-in. */
const NEAR_AI_CLOUD_URL = "https://cloud.near.ai";
const STAKING_DOCS_URL = "https://docs.near.ai/cloud/staking-for-inference/overview";

/**
 * NEAR AI's Staking for Inference, explained and linked out: the stake, the wallet and the
 * organization stay the person's own. Only what docs/staking-for-inference.md confirms;
 * no minimum, unstaking delay or rate, since those aren't published.
 */
function StakingCard({ spend, sample }: { spend?: Spend | null; sample?: boolean }) {
  const typical = typicalMeetingCost(30);
  const average = spend && spend.meetings > 0 && spend.cost.usd !== null ? formatCost(spend.cost.usd / spend.meetings) : null;
  const yours = !average ? null : sample ? `The sample meeting cost ${average}.` : spend!.meetings === 1 ? `Your meeting here cost ${average}.` : `Your meetings here averaged ${average} each.`;
  return (
    <Card pad="none">
      <CardRow
        divider
        icon={
          <IconDisc>
            <Coins size={16} strokeWidth={1.75} />
          </IconDisc>
        }
        title="Pay by staking"
        detail="Stake NEAR instead of buying credits. You keep the NEAR; its staking rewards pay for your notes."
      >
        <LinkButton href={NEAR_AI_CLOUD_URL}>Open cloud.near.ai</LinkButton>
      </CardRow>
      <ul className="m-0 flex list-disc flex-col gap-1.5 py-4 pr-5 pl-10 text-[13px] leading-[19px] text-ink-2 marker:text-muted">
        <li>The rewards become NEAR AI Cloud credits, 1 credit for $1 of use. They're spent before any credits you buy.</li>
        <li>Unstake any time to get your NEAR back. The credits stop when you do.</li>
        <li>Mainnet only: it takes real NEAR, not testnet NEAR.</li>
        <li>Your key, your organization, your stake. Aftercall never holds NEAR or a NEAR AI sign-in; it only uses the API key you paste above.</li>
        <li>
          A 30-minute meeting costs {formatCost(typical.usd ?? 0)} at NEAR AI's prices on {pricesDay(typical.pricesAsOf)}. {yours}
        </li>
      </ul>
      <Why label="How do I start?" className="border-t border-hairline px-5 py-3">
        <span className="flex flex-col gap-2">
          <span>
            Sign in to cloud.near.ai with your NEAR wallet, not email, and stake from your organization's Credits page. Then make the API key in that same
            organization, so its credits pay for your notes.
          </span>
          <LinkButton href={STAKING_DOCS_URL}>How staking works</LinkButton>
        </span>
      </Why>
    </Card>
  );
}
