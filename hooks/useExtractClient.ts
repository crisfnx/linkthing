import { useEffect, useRef } from "react";
import {
  createExtractClient,
  startExtractWorker,
  type ExtractClient,
} from "@/lib/workers/client";

// The page's one extraction worker, shared by the import and the library
// (§8.2). It starts the first time something asks for it and stops with the
// page; under Strict Mode's second mount in development, or after it crashes,
// the next ask starts a new one.
export function useExtractClient(
  create: (onCrash: () => void) => ExtractClient = (onCrash) =>
    createExtractClient(startExtractWorker(), onCrash),
): () => ExtractClient {
  const client = useRef<ExtractClient | null>(null);
  useEffect(
    () => () => {
      client.current?.terminate();
      client.current = null;
    },
    [],
  );
  return () => {
    if (client.current) return client.current;
    const fresh = create(() => {
      // Only if it is still the page's worker: a new one may have started.
      if (client.current === fresh) client.current = null;
    });
    return (client.current = fresh);
  };
}
