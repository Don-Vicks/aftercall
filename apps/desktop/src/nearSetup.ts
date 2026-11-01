import { useEffect, useState } from "react";
import { accountFitsNetwork } from "@aftercall/core";
import { near, setupCommands, signInWallet, waitFor, type NearConfig, type NearStatus } from "./near";
import { isDesktop } from "./recorder";
import { recovery, type RecoveryStatus } from "./recovery";
import { errorText } from "./SettingsParts";

/** Whether each saved name was found on NEAR by "Save and check" (absent: not checked yet). */
export interface Found {
  account?: boolean;
  contract?: boolean;
}

/**
 * Everything Settings and Set up payments need to connect NEAR: the account and
 * contract, this Mac's key (from the recovery phrase), and the two signatures that
 * register the agent wallet and authorise the key. The app holds its own limited
 * key; the owner authorises it once from their own wallet or near-cli, so the app
 * can only record proofs and pay within the contract's caps.
 */
export function useNearSetup() {
  const [config, setConfig] = useState<NearConfig>({ network: "testnet", account: "", contract: "" });
  /** What's saved on this Mac, as last loaded or saved. */
  const [saved, setSaved] = useState<NearConfig | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<NearStatus | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [found, setFound] = useState<Found>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which action the error came from, so it shows next to that action. */
  const [errorFrom, setErrorFrom] = useState<"load" | "check" | "sign">("load");
  /** The first look at the saved setup has finished (or there was nothing to look at). */
  const [loaded, setLoaded] = useState(!isDesktop);
  /** The signature the owner is being waited on for ("Create wallet"). */
  const [waiting, setWaiting] = useState<string | null>(null);

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
        // Already set up on an earlier visit: show where it stands without a click.
        const r = await recovery.status().catch(() => null);
        if (r?.hasKey) setStatus(await near.status());
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

  // A testnet account in a mainnet setup (or the other way round) can't work; say so before anything is signed.
  const wrongNetwork = [config.account, config.contract].find((a) => a.length > 1 && !accountFitsNetwork(a, config.network)) ?? null;
  const ready = config.account.length > 1 && config.contract.length > 1 && !wrongNetwork;
  const commands = ready && publicKey ? setupCommands(config, publicKey) : null;
  const connected = Boolean(status?.registered && status.keyAdded);
  /** The saved account still matches what's typed, so "found" applies to it. */
  const unchanged = saved !== null && saved.account === config.account && saved.contract === config.contract && saved.network === config.network;
  const accountDone = Boolean(saved && unchanged && ready && found.account !== false && found.contract !== false);
  const signed = (status?.registered ? 1 : 0) + (status?.keyAdded ? 1 : 0);

  const edit = (next: NearConfig) => {
    setConfig(next);
    setError(null);
  };

  /** Saves the account and contract, checks both exist on NEAR, then reads where setup stands. True when nothing failed. */
  const check = async (): Promise<boolean> => {
    setError(null);
    setErrorFrom("check");
    setChecking(true);
    try {
      await near.saveConfig(config);
      setSaved(config);
      const [account, contract] = await Promise.all([near.checkPayee(config.account), near.checkPayee(config.contract)]);
      setFound({ account: account.exists, contract: contract.exists });
      if (publicKey) setStatus(await near.status());
      return account.exists && contract.exists;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setChecking(false);
    }
  };

  /** Opens the signing page in the browser and checks NEAR until the step lands. */
  const signStep = async (label: string, kind: "register" | "authorise-key") => {
    setError(null);
    setErrorFrom("sign");
    try {
      await near.saveConfig(config);
      setSaved(config);
      await signInWallet(kind === "register" ? { kind } : { kind, publicKey });
      setWaiting(label);
      const done = await waitFor(async () => {
        const s = await near.status();
        setStatus(s);
        return kind === "register" ? s.registered : s.keyAdded;
      });
      if (!done) setError(`Didn't see “${label}” on NEAR yet. If you signed, press Save and check in a moment.`);
      return done;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setWaiting(null);
    }
  };

  return {
    config,
    edit,
    saved,
    publicKey,
    status,
    recoveryStatus,
    found: unchanged ? found : {},
    checking,
    error,
    errorFrom,
    loaded,
    waiting,
    wrongNetwork,
    ready,
    commands,
    connected,
    accountDone,
    signed,
    check,
    signStep,
    keyChanged,
  };
}

export type NearSetup = ReturnType<typeof useNearSetup>;
