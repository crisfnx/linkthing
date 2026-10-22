import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useEffectEvent, useState } from "react";
import type { LinkVaultDb } from "@/lib/db/schema";
import { RowsBuilder, type LibraryRows } from "@/lib/library/rows";
import type { ExtractClient } from "@/lib/workers/client";

export type Library =
  | { status: "loading" }
  | { status: "ready"; rows: LibraryRows }
  | { status: "failed"; message: string };

const EMPTY: Library = { status: "ready", rows: new RowsBuilder().finish() };

// The library's rows, read by the worker (§5). The links table isn't behind a
// live query; the sources table is, and every import, update and delete
// changes a source's id or updatedAt, so that is when the rows are read
// again, from this tab or another. Until the new rows arrive the old ones
// stay. An empty library needs no worker at all.
export function useLibrary(
  db: LinkVaultDb,
  connect: () => ExtractClient,
): Library {
  const version = useLiveQuery(
    async () =>
      (await db.sources.toArray())
        .map((source) => `${source.id}@${source.updatedAt}`)
        .sort()
        .join(" "),
    [db],
  );
  const [loaded, setLoaded] = useState<Library>({ status: "loading" });
  const load = useEffectEvent(() => connect().load());

  useEffect(() => {
    if (!version) return; // still reading, or nothing to read
    let current = true;
    load().then(
      (rows) => current && setLoaded({ status: "ready", rows }),
      (error: unknown) =>
        current &&
        setLoaded({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      current = false;
    };
  }, [version]);

  return version === "" ? EMPTY : loaded;
}
