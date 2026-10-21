import type { Adapter, AdapterInput, SourceKind } from "@/lib/extract/types";
import { plaintext } from "./plaintext";

// Specialized adapters go before plaintext, which reads anything.
export const ADAPTERS: readonly Adapter[] = [plaintext];

// A specialized adapter is picked at 0.6 or more (§3: "≥ 60 % of the first 50
// non-empty lines" for WhatsApp). Between 0.2 and 0.6 the import dialog asks.
const DETECTED = 0.6;
const UNSURE = 0.2;

export interface Detection {
  kind: SourceKind;
  scores: Array<{ kind: SourceKind; score: number }>; // highest first
  needsConfirmation: boolean;
}

export function detectAdapter(
  input: AdapterInput,
  adapters: readonly Adapter[] = ADAPTERS,
): Detection {
  const scores = adapters
    .map((adapter) => ({ kind: adapter.kind, score: adapter.detect(input) }))
    .sort((a, b) => b.score - a.score);
  const specialized = scores.filter((s) => s.kind !== "plaintext");
  const best = specialized.find((s) => s.score >= DETECTED);
  const unsure = specialized.some(
    (s) => s.score >= UNSURE && s.score < DETECTED,
  );

  return {
    kind: best?.kind ?? "plaintext",
    scores,
    needsConfirmation: !best && unsure,
  };
}
