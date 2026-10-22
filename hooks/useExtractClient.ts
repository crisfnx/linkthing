import { useEffect, useRef } from "react";
import { createExtractClient, type ExtractClient } from "@/lib/workers/client";

// The page's one extraction worker, shared by the import and the library
// (§8.2). It starts the first time something asks for it and stops with the
// page; under Strict Mode's second mount in development, the next ask starts
// a new one.
export function useExtractClient(
  create: () => ExtractClient = createExtractClient,
): () => ExtractClient {
  const client = useRef<ExtractClient | null>(null);
  useEffect(
    () => () => {
      client.current?.terminate();
      client.current = null;
    },
    [],
  );
  return () => (client.current ??= create());
}
