"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Importer } from "@/components/import/Importer";
import { useExtractClient } from "@/hooks/useExtractClient";
import { useLibrary } from "@/hooks/useLibrary";
import { createDb } from "@/lib/db/schema";
import { strings } from "@/lib/strings";
import { LibraryView } from "./LibraryView";

// Everything that needs the browser: IndexedDB and the worker (§8.2). Loaded
// by WorkspaceLoader, so it never renders on the server.
export default function Workspace() {
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);
  // The page's own connection, for the small live tables. It stays open with
  // the page. When another tab opens a newer schema, Dexie closes it so that
  // upgrade isn't blocked, and this page asks for a reload.
  const [db] = useState(() =>
    createDb(undefined, () => setUpgradeNeeded(true)),
  );
  // Small, so a live query. Undefined until read: neither screen shows
  // before it's known which one applies.
  const sources = useLiveQuery(() => db.sources.toArray(), [db]);
  const connect = useExtractClient();
  const library = useLibrary(db, connect);
  const sourceNames = new Map(sources?.map((s) => [s.id, s.name]));
  const hasSources = sources !== undefined && sources.length > 0;

  return (
    <>
      {upgradeNeeded && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-10 flex flex-wrap items-center justify-center gap-3 bg-foreground p-3 text-background"
        >
          <p>{strings.upgradeNeeded}</p>
          <button
            type="button"
            className="rounded-md border border-current px-3 py-1 font-medium"
            onClick={() => location.reload()}
          >
            {strings.reload}
          </button>
        </div>
      )}
      {sources !== undefined && (
        <Importer
          connect={connect}
          empty={sources.length === 0}
          library={hasSources}
        >
          {hasSources && (
            <div className="flex min-h-0 flex-1 flex-col">
              {library.status === "failed" && (
                <p role="alert" className="px-4 py-2">
                  {strings.libraryFailed(library.message)}
                </p>
              )}
              {library.status === "loading" && (
                <p className="px-4 py-2">{strings.libraryLoading}</p>
              )}
              {library.status === "ready" &&
                (library.rows.count === 0 ? (
                  <p className="px-4 py-2">{strings.libraryHasNoLinks}</p>
                ) : (
                  <LibraryView
                    db={db}
                    rows={library.rows}
                    sourceNames={sourceNames}
                  />
                ))}
            </div>
          )}
        </Importer>
      )}
    </>
  );
}
