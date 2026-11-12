import { Icon, SiteFooter, SiteHeader, vars, type IconName } from "../ui";
import c from "../handling/handling.module.css";
import { FIRST_REAL_CALL, PAYMENT_CALL, PROOF_RUN } from "./links";

export const metadata = {
  title: "What has run on NEAR testnet · Aftercall",
  description: "Every transaction Aftercall has made on NEAR testnet, one click each: notes made in secure hardware and re-checked in your browser, payments within caps, a payment held over them, and a deal held in escrow.",
};

const TX = "https://testnet.nearblocks.io/txns/";
const REPO = "https://github.com/Don-Vicks/aftercall";

type Where = "mac" | "tee" | "near";
type Link = { label: string; href: string };
type Item = { where: Where; title: string; body: string; links: Link[] };
type Run = { id: string; when: string; title: string; intro: string; items: Item[] };

const tx = (label: string, hash: string): Link => ({ label: `${label} · ${hash.slice(0, 8)}…`, href: `${TX}${hash}` });
const verify = (fragment: string): Link => ({ label: "Re-check the proof in your browser", href: `/verify#${fragment}` });

const RUNS: Run[] = [
  {
    id: "mac-app",
    when: "8 Nov 2026",
    title: "The Mac app, one sample call",
    intro: "A made-up call with two computer voices, recorded in the Mac app. The call promised Kemi $5 and $5,000.",
    items: [
      {
        where: "tee",
        title: "Notes made in NEAR AI's secure hardware, proof on NEAR",
        body: "All 30 checks passed when the notes were made. The proof's hash went on NEAR; its link holds hashes, nonces and signatures, never what was said.",
        links: [verify(PAYMENT_CALL)],
      },
      {
        where: "near",
        title: "Kemi was promised $5: the app paid 5 USDC",
        body: "Signed by the Mac's limited key, which can only pay listed payees within the caps, and linked to the meeting's proof.",
        links: [tx("pay", "6jK1mauqjVNhhJnmvVuhPiP8DzxCBR9Na9ysoKo6jmKN")],
      },
      {
        where: "near",
        title: "The same call's $5,000 was held",
        body: "Over the 10 USDC per-payment cap, so the contract parked it for the owner's own wallet (OVER_PAYMENT_CAP). Nothing moved.",
        links: [tx("pay, held", "6jHzBdiTCbcgdQ7QbCXySWW1fPEeypik3ZxV7SqXiLou"), { label: "Watch it, 1:30", href: "https://x.com/VictorShallang/status/2119529850646020401" }],
      },
    ],
  },
  {
    id: "proof-run",
    when: "12 Nov 2026",
    title: "The app's after-call code, run headless",
    intro: "The same core code as the Mac app, run from a script with test accounts (demo-owner and demo-freelancer.aftercall.testnet). Anyone can run it: pnpm --filter @aftercall/core proof:run.",
    items: [
      {
        where: "tee",
        title: "A sample call's notes from NEAR AI's TEEs, proof on NEAR",
        body: "30 of 30 checks passed; the proof was recorded by the owner's limited app key.",
        links: [tx("record_proof", "Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi"), verify(PROOF_RUN)],
      },
      {
        where: "near",
        title: "Autopilot paid 1 USDC on its own",
        body: "The call said “I'll pay the illustrator $1 today”. Every autopilot rule passed, it waited out its 60-second undo window, then paid inside the cap.",
        links: [tx("pay", "Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP")],
      },
      {
        where: "near",
        title: "0.50 USDC held in escrow until the payee confirmed",
        body: "The call made it wait on a condition, so it became a deal. Confirming different terms was refused before anything was sent; the payee then confirmed the exact terms from their own account, and it was released.",
        links: [
          tx("open", "AFvFRrFxu5dNkXEawpWF3RuptPTEjZR9fVqSLxmHZDWi"),
          tx("confirmed", "4eEmcyisyppCVkXDN7ikymrQDSLw5oEtoLqXs7trLcLp"),
          tx("released", "8d7msRRgDyQfLi1aWNidLwSSGuxVeGBcNc6Vt8qfgJMw"),
        ],
      },
    ],
  },
  {
    id: "limits",
    when: "12 Nov 2026",
    title: "The limits, tested on testnet",
    intro: "A limited app key like the Mac's, on the test owner's account, against the live contract.",
    items: [
      {
        where: "near",
        title: "Within the cap: paid",
        body: "0.50 USDC to a listed payee, under the 1.00 per-payment cap.",
        links: [tx("pay", "25hyBPU5BzPknia4zzSHnPjBG6RVvz2TaQYNSSurbEUt")],
      },
      {
        where: "near",
        title: "Over the cap: held, then approved by the owner",
        body: "2.00 USDC was parked for the owner, whose own account then approved it.",
        links: [tx("held", "CGqtWddPhTKHMPqPbRRConbC7wSxAo8oSsYzTb5HEdfm"), tx("approved", "6CbYm7qUaM76WiaPZuycysnXx8Yjq3ChYDVMwTrsAvNN")],
      },
      {
        where: "near",
        title: "Withdraw the wallet: refused",
        body: "The app key isn't allowed to call withdraw, so NEAR wouldn't send it: “Transaction method name <withdraw> isn't allowed by the access key”. There is no transaction.",
        links: [],
      },
    ],
  },
  {
    id: "first",
    when: "2–3 Nov 2026",
    title: "The first proof from a real call",
    intro: "A real meeting, made into notes on live NEAR AI and kept private: its link shows the evidence, never the content.",
    items: [
      {
        where: "tee",
        title: "Proof recorded by the Mac app",
        body: "Notes made on 2 Nov, proof recorded on NEAR on 3 Nov with the app's limited key.",
        links: [tx("record_proof", "2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro"), verify(FIRST_REAL_CALL)],
      },
    ],
  },
];

const WHERE: Record<Where, { label: string; icon: IconName }> = {
  mac: { label: "On the Mac", icon: "laptop" },
  tee: { label: "NEAR AI TEE", icon: "shieldCheck" },
  near: { label: "On NEAR", icon: "chain" },
};

export default function Proof() {
  return (
    <>
      <SiteHeader />
      <main>
        <section aria-labelledby="hero" className={c.hero}>
          <div className={c.heroInner}>
            <span className={`${c.eyebrow} enter`}>No wallet needed</span>
            <h1 id="hero" className={`${c.h1} enter`} style={vars({ d: "40ms", dur: "360ms" })}>
              What has run on NEAR testnet
            </h1>
            <p className={`${c.lede} enter`} style={vars({ d: "100ms", dur: "360ms" })}>
              Every link below is a real transaction on NEAR testnet, on the contract <code>wallet.aftercall.testnet</code>, or a proof your browser re-checks against it.
            </p>
          </div>
        </section>

        {RUNS.map((run, r) => (
          <section key={run.id} id={run.id} aria-labelledby={`${run.id}-h`} className={c.section}>
            <div className={c.wrap}>
              <h2 id={`${run.id}-h`} className={c.h2}>
                {run.title}
              </h2>
              <p className={c.intro}>
                <span className="ink-2">{run.when} · </span>
                {run.intro}
              </p>
              <ol className={c.steps}>
                {run.items.map((s, i) => (
                  <li key={s.title} className={`${c.step} enter`} style={vars({ d: `${120 + (r * 3 + i) * 30}ms`, dur: "240ms" })}>
                    <span aria-hidden="true" className={`${c.num} ${c[s.where]}`}>
                      {i + 1}
                    </span>
                    <span className={c.stepText}>
                      <span className={c.stepTitle}>{s.title}</span>
                      <span className={c.stepBody}>{s.body}</span>
                      {s.links.length > 0 && (
                        <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 6 }}>
                          {s.links.map((l) => (
                            <a key={l.href} href={l.href} className="arrow-link" {...(l.href.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" })}>
                              {l.label}
                              <Icon name="arrowRight" size={14} stroke={2.2} />
                            </a>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className={c.stepMeta}>
                      <span className={c.where}>
                        <Icon name={WHERE[s.where].icon} size={14} stroke={1.75} />
                        {WHERE[s.where].label}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ))}

        <section aria-labelledby="not-yet" className={c.section}>
          <div className={c.wrap}>
            <h2 id="not-yet" className={c.h2}>
              Not yet
            </h2>
            <p className={c.intro}>
              Approving a held payment at /sign or confirming a deal at /deal in a browser wallet, autopilot from the Mac app&apos;s own runner, and anything on mainnet. The full status, with the code and tests behind each
              claim, is in the{" "}
              <a href={`${REPO}#features-and-status`} className="arrow-link">
                README
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
