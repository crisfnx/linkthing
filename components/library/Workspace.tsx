"use client";

import { useState } from "react";
import { Importer } from "@/components/import/Importer";
import { createDb } from "@/lib/db/schema";
import { strings } from "@/lib/strings";
import { SourceList } from "./SourceList";

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
      <Importer>
        <SourceList db={db} />
      </Importer>
    </>
  );
}
