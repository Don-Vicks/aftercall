import { DEFAULT_RULES, type AutopilotRules } from "@aftercall/core";

const KEY = "aftercall.autopilot";

/** Autopilot rules live on this Mac only. */
export function loadRules(): AutopilotRules {
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: AutopilotRules): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    // Private mode or storage blocked: rules fall back to off.
  }
}
