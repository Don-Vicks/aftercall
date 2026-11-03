import { useEffect, useState } from "react";
import { accountFitsNetwork, type OwnerAction } from "@aftercall/core";
import { builtInContract, near, setupCommands, signInWallet, waitFor, type NearConfig, type NearStatus, type SetupCheck } from "./near";
import { isDesktop } from "./recorder";
import { recovery, type RecoveryStatus } from "./recovery";
import { errorText } from "./SettingsParts";

/** What the account check found for each name (absent: not checked yet). */
export interface Found {
  account?: boolean;
  contract?: SetupCheck["contract"];
}

/** What first-time setup still needs the owner's wallet for, as one signing request. */
export type SetupAction = Extract<OwnerAction, { kind: "setup" }>;

/** A signature the owner was waited on for that didn't show on NEAR in time; "Check again" looks once more. */
export interface Unseen {
  label: string;
  action: SetupAction;
}

/**
 * Everything Settings and Set up payments need to connect NEAR: the account (the
 * contract is Aftercall's own for the network, unless the owner points at their own
 * deployment), this Mac's key (from the recovery phrase), and the one wallet approval
 * that registers the agent wallet, sets its daily cap and authorises the key. The app holds its own limited
 * key; the owner authorises it once from their own wallet or near-cli, so the app
 * can only record proofs and pay within the contract's caps.
 */
export function useNearSetup() {
  const [config, setConfig] = useState<NearConfig>({ network: "testnet", account: "", contract: builtInContract("testnet") ?? "" });
  /** What's saved on this Mac, as last loaded or saved. */
  const [saved, setSaved] = useState<NearConfig | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<NearStatus | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  /** What the account check found, and for which names: it applies only while they're unchanged. */
  const [checked, setChecked] = useState<{ config: NearConfig; found: Found } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which action the error came from, so it shows next to that action. */
  const [errorFrom, setErrorFrom] = useState<"load" | "check" | "sign">("load");
  /** The first look at the saved setup has finished (or there was nothing to look at). */
  const [loaded, setLoaded] = useState(!isDesktop);
  /** The signature the owner is being waited on for ("Create wallet"). */
  const [waiting, setWaiting] = useState<string | null>(null);
  const [unseen, setUnseen] = useState<Unseen | null>(null);
  const [rechecking, setRechecking] = useState(false);

  /** This Mac's key, which a new install only has once a recovery phrase is made or restored. */
  const loadKey = async () => {
    const r = await recovery.status();
    setRecoveryStatus(r);
    setPublicKey(r.publicKey ?? "");
    return r;
  };

  useEffect(() => {
    loadKey().catch((e) => setError(errorText(e)));
    if (!isDesktop) return;
    near
      .getConfig()
      .then(async (c) => {
        if (!c) return;
        setConfig(c);
        setSaved(c);
        // Already set up on an earlier visit: show where it stands without a click. A contract
        // that's gone or isn't Aftercall's is said under the account, not read as "not signed".
        const r = await recovery.status().catch(() => null);
        if (r?.hasKey)
          await near
            .status()
            .then(setStatus)
            .catch((e) => {
              setErrorFrom("check");
              setError(errorText(e));
            });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  /** After a new or restored key: check NEAR again, since the contract may already know it. */
  const keyChanged = async () => {
    setStatus(null);
    const r = await loadKey().catch(() => null);
    if (r?.hasKey && (await near.getConfig().catch(() => null)))
      await near
        .status()
        .then(setStatus)
        .catch(() => {});
  };

  /** Aftercall's contract on the chosen network, or null where there's none yet (mainnet today). */
  const builtIn = builtInContract(config.network);
  /** The contract isn't the network's built-in one: the owner's own deployment, typed under "Advanced". */
  const ownContract = config.contract !== builtIn;
  // A testnet account in a mainnet setup (or the other way round) can't work; say so before anything is signed.
  const wrongNetwork = [config.account, config.contract].find((a) => a.length > 1 && !accountFitsNetwork(a, config.network)) ?? null;
  const ready = config.account.length > 1 && config.contract.length > 1 && !wrongNetwork;
  const commands = ready && publicKey ? setupCommands(config, publicKey) : null;
  const connected = Boolean(status?.registered && status.keyAdded);
  const same = (a: NearConfig | null) => a !== null && a.account === config.account && a.contract === config.contract && a.network === config.network;
  const found: Found = checked && same(checked.config) ? checked.found : {};
  /** The saved account still matches what's typed, and nothing found it wanting. */
  const accountDone = Boolean(same(saved) && ready && found.account !== false && (found.contract === undefined || found.contract === "ok"));

  const edit = (next: NearConfig) => {
    // Switching network swaps in that network's contract, unless the owner typed their own.
    if (next.network !== config.network && (config.contract === builtIn || config.contract === "")) next = { ...next, contract: builtInContract(next.network) ?? "" };
    setConfig(next);
    setError(null);
    setUnseen(null);
  };

  /** What's wrong with the contract, as the account check found it. */
  const contractProblem = (c: NearConfig, f: Found): string | null =>
    f.contract === "missing" ? `No Aftercall contract at ${c.contract} on ${c.network} yet.` : f.contract === "wrong" ? `${c.contract} isn't the Aftercall contract.` : null;

  /**
   * Checks the account exists and the contract is Aftercall's (its USDC must be this
   * network's), and only then saves near.json and reads where setup stands. Returns
   * what's wrong, or null when it's saved.
   */
  const verify = async (): Promise<string | null> => {
    const result = await near.checkSetup(config);
    const f: Found = { account: result.account, contract: result.contract };
    setChecked({ config, found: f });
    if (!result.account) return `${config.account} isn't on NEAR ${config.network}.`;
    const problem = contractProblem(config, f);
    if (problem) return problem;
    await near.saveConfig(config);
    setSaved(config);
    if (publicKey) setStatus(await near.status());
    return null;
  };

  /** The account check ("Check and continue"). True when the account and contract passed and were saved. */
  const check = async (): Promise<boolean> => {
    setError(null);
    setErrorFrom("check");
    setChecking(true);
    try {
      // What's wrong shows by the fields (account) or under them (contractProblem), so no error here.
      return (await verify()) === null;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setChecking(false);
    }
  };

  /** Whether everything the request asked for has landed on NEAR, reading the status once. */
  const landed = async (action: SetupAction) => {
    const s = await near.status();
    setStatus(s);
    return (!action.register || s.registered) && (!action.publicKey || s.keyAdded);
  };

  /** Opens the signing page in the browser and checks NEAR every 3 s for two minutes until the request lands. */
  const signSetup = async (label: string, action: SetupAction) => {
    setError(null);
    setErrorFrom("sign");
    setUnseen(null);
    try {
      // Nothing is signed against an account or contract that hasn't passed the account check.
      if (!accountDone) {
        const problem = await verify();
        if (problem) {
          setError(problem);
          return false;
        }
      }
      await signInWallet(action);
      setWaiting(label);
      const done = await waitFor(() => landed(action));
      if (!done) setUnseen({ label, action });
      return done;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setWaiting(null);
    }
  };

  /** After the two minutes: one more look, for a wallet that took longer. */
  const checkAgain = async () => {
    if (!unseen) return false;
    setError(null);
    setErrorFrom("sign");
    setRechecking(true);
    try {
      const done = await landed(unseen.action);
      if (done) setUnseen(null);
      return done;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setRechecking(false);
    }
  };

  return {
    config,
    edit,
    saved,
    publicKey,
    status,
    recoveryStatus,
    found,
    contractProblem: contractProblem(config, found),
    builtIn,
    ownContract,
    checking,
    error,
    errorFrom,
    loaded,
    waiting,
    unseen,
    rechecking,
    wrongNetwork,
    ready,
    commands,
    connected,
    accountDone,
    check,
    signSetup,
    checkAgain,
    keyChanged,
  };
}

export type NearSetup = ReturnType<typeof useNearSetup>;
