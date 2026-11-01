import { NearAiConnect } from "./NearAiConnect";
import { Why } from "./SettingsParts";
import { SectionTitle } from "./ui";

/** The NEAR AI section of Settings. `onChange` hears whether a key is saved, for the section index. */
export function NearAiSettings({ onChange }: { onChange?: (connected: boolean) => void }) {
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
    </section>
  );
}
