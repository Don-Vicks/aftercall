import { NearAiConnect } from "./NearAiConnect";
import { SectionLabel } from "./ui";

/** The NEAR AI section of Settings. */
export function NearAiSettings() {
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>NEAR AI</SectionLabel>
      <p className="m-0 text-muted">Your notes are made by NEAR AI's private models, which run in secure hardware. The key is kept in your macOS Keychain.</p>
      <NearAiConnect />
    </section>
  );
}
