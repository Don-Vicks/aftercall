import { ReceiptText } from "lucide-react";
import { NearAiConnect } from "./NearAiConnect";
import { CardRow, IconDisc, Why } from "./SettingsParts";
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
