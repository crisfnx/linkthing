"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useId } from "react";
import type { LinkVaultDb } from "@/lib/db/schema";
import { strings } from "@/lib/strings";

// A short list of what has been imported, newest first. The sources table is
// small, so it's a live query (§8.2); imports in the worker or in another tab
// show up on their own.
export function SourceList({ db }: { db: LinkVaultDb }) {
  const headingId = useId();
  const sources = useLiveQuery(
    () => db.sources.orderBy("importedAt").reverse().toArray(),
    [db],
  );
  if (!sources || sources.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {strings.sourcesHeading}
      </h2>
      <ul className="flex flex-col gap-1">
        {sources.map((source) => (
          <li key={source.id}>
            <span className="font-medium">{source.name}</span>
            <span className="text-sm opacity-70">
              {" · "}
              {[
                strings.sourceKind(source.kind),
                strings.sourceLinks(source.stats.links),
                strings.sourceImported(source.importedAt),
              ].join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
