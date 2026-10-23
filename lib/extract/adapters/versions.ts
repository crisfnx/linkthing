import type { SourceKind } from "@/lib/extract/types";

// Each adapter's version, here rather than in the adapters, so the page can
// tell a source read by an older adapter (offering re-extract, §3) without
// loading the adapters themselves. Bump one when its adapter would read a
// stored source differently.
export const ADAPTER_VERSIONS: Partial<Record<SourceKind, number>> = {
  plaintext: 1,
  whatsapp: 1,
};
