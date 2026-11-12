import { WEB_URL } from "./near";

/**
 * The browser demo at getaftercall.vercel.app/demo (VITE_DEMO=1): the app's own browser
 * preview with its sample meetings, so people can look around without a Mac, a download or
 * a NEAR AI key. Recording, notes and payments still need the Mac app, which says so.
 */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

/** The strip above the demo: what this is, and where the real app is. */
export function DemoBanner() {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hairline bg-verdigris-tint px-4 py-2 text-[13px] text-ink-2">
      <span>
        <span className="font-semibold text-verdigris">Demo</span> · a sample meeting; payments here are simulated. Try: approve the 50 USDC · review the $5,000 held for your wallet · click Verified.
      </span>
      <a href={`${WEB_URL}/proof`} className="font-semibold text-verdigris underline-offset-2 hover:underline">
        See the real ones on NEAR testnet →
      </a>
      <span className="hidden max-[900px]:inline text-muted">Best on a laptop.</span>
      <a href={`${WEB_URL}/download?ref=demo`} className="font-semibold text-verdigris underline-offset-2 hover:underline">
        Get the test build →
      </a>
    </div>
  );
}
