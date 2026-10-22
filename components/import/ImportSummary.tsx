"use client";

import { useId } from "react";
import type { Imported } from "@/lib/import/save";
import { strings } from "@/lib/strings";

// The result summary (§6.1): links found (new links, for an update), unique
// links, sites, date range and skipped non-web links. An update shows the
// whole chat's numbers under the count it added.
export function ImportSummary({ results }: { results: Imported[] }) {
  const headingId = useId();
  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {strings.summaryHeading}
      </h2>
      {results.map(({ sourceId, name, updated, stats, newLinks }) => (
        <article key={sourceId} className="flex flex-col gap-2">
          <h3 className="font-semibold">{name}</h3>
          <p>
            {stats.links === 0
              ? strings.noLinks(stats.messages)
              : updated
                ? strings.newLinksAdded(newLinks)
                : strings.linksFound(stats.links)}
          </p>
          {stats.links > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>{strings.links}</dt>
              <dd>{strings.formatNumber(stats.links)}</dd>
              <dt>{strings.uniqueLinks}</dt>
              <dd>{strings.formatNumber(stats.uniqueLinks)}</dd>
              <dt>{strings.sites}</dt>
              <dd>{strings.formatNumber(stats.domains)}</dd>
              {stats.earliest !== undefined && stats.latest !== undefined && (
                <>
                  <dt>{strings.dates}</dt>
                  <dd>{strings.dateRange(stats.earliest, stats.latest)}</dd>
                </>
              )}
              <dt>{strings.skippedNonWeb}</dt>
              <dd>{strings.formatNumber(stats.skippedNonWeb)}</dd>
            </dl>
          )}
        </article>
      ))}
    </section>
  );
}
