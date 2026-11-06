import { useState } from "react";
import { Card, Field, Input, SectionTitle } from "./ui";

const KEY = "aftercall.senderName";

/** The name recaps go out under. On this Mac only; empty until you set it. */
export function senderName(): string {
  try {
    return (localStorage.getItem(KEY) ?? "").trim();
  } catch {
    return "";
  }
}

function saveSenderName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // Storage blocked: recaps fall back to your NEAR account name.
  }
}

/** Recaps: the name they're sent under, signed with, and given to action items the notes say are yours. */
export function RecapSettings() {
  const [name, setName] = useState(senderName);
  return (
    <section aria-labelledby="h-recaps" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id="h-recaps">Recaps</SectionTitle>
        <p className="m-0 text-ink-2">How the people on your calls see your recaps.</p>
      </div>
      <Card pad="md">
        <Field
          label="Your name"
          hint={
            name.trim()
              ? `Recaps come from “${name.trim()} via Aftercall”, end with your name, and show your action items as yours.`
              : "Without it, recaps come from your NEAR account name."
          }
        >
          <Input
            value={name}
            maxLength={60}
            autoComplete="name"
            placeholder="e.g. Victor"
            onChange={(e) => {
              // Saved as you type, so leaving Settings straight away doesn't lose it.
              setName(e.target.value);
              saveSenderName(e.target.value);
            }}
          />
        </Field>
      </Card>
    </section>
  );
}
