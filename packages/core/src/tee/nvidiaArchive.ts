import archive from "./nvidia-archive.json" with { type: "json" };
import type { Jwks } from "./nvidia.ts";

/**
 * NVIDIA NRAS keys that signed the GPU tokens in published proofs, kept after NVIDIA
 * stops listing them (about two days after making each), with the certificate chains
 * NVIDIA served beside them. Only a copy: /verify uses a key from it only after
 * `verifyKeyChain` (nvidiaChain.ts) shows NVIDIA certified it. Refreshed, never pruned,
 * by `pnpm --filter @aftercall/core nvidia:archive` (scripts/archive-nvidia-keys.ts).
 */
export const NVIDIA_KEY_ARCHIVE: Jwks = archive;
