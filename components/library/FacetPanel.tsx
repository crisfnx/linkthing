"use client";

import { useId, useState, type ReactNode } from "react";
import type { LinkKind } from "@/lib/extract/types";
import type { Facets, FacetValue, Query } from "@/lib/query/view";
import { strings } from "@/lib/strings";

type Group = "sites" | "kinds" | "senders" | "sources" | "dates";

const TOP_SITES = 20;

interface Props {
  facets: Facets;
  query: Query;
  sourceNames: ReadonlyMap<string, string>;
  onChange: (group: Group, values: string[]) => void;
}

function toggled(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

function Option({
  value,
  label,
  count,
  selected,
  onToggle,
}: FacetValue & { label: string; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2 py-0.5" data-value={value}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-foreground/65 tabular-nums">
        {strings.formatNumber(count)}
      </span>
    </label>
  );
}

function Section({
  title,
  chosen,
  onClear,
  children,
}: {
  title: string;
  chosen: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  // The legend names the group for screen readers. Browsers draw a legend on
  // the fieldset's top edge, outside its content box, so it can't share a row
  // with Clear; the row shows the title instead.
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="sr-only">{title}</legend>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span aria-hidden className="font-semibold">
          {title}
        </span>
        {chosen && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onClear}
          >
            {strings.clear}
          </button>
        )}
      </div>
      {children}
    </fieldset>
  );
}

// The filters beside the list (§6.3): sites (the busiest twenty, then all),
// kinds, senders, sources and dates by year and month, each value with how
// many links choosing it would give. Any value within a group, every group
// across them.
export function FacetPanel({ facets, query, sourceNames, onChange }: Props) {
  const [allSites, setAllSites] = useState(false);
  const [openYears, setOpenYears] = useState<ReadonlySet<string>>(new Set());
  const monthsId = useId();

  const sites = allSites
    ? facets.sites
    : facets.sites.filter((v, i) => i < TOP_SITES || v.selected);

  const group = (
    name: Group,
    values: FacetValue[],
    label: (v: string) => string,
  ) =>
    values.map((v) => (
      <Option
        key={v.value}
        {...v}
        label={label(v.value)}
        onToggle={() => onChange(name, toggled(query[name], v.value))}
      />
    ));

  return (
    <div className="flex flex-col gap-6 text-sm">
      <Section
        title={strings.filterGroups.sites}
        chosen={query.sites.length > 0}
        onClear={() => onChange("sites", [])}
      >
        {group("sites", sites, (v) => v)}
        {facets.sites.length > TOP_SITES && (
          <button
            type="button"
            className="self-start underline underline-offset-2"
            onClick={() => setAllSites(!allSites)}
          >
            {allSites
              ? strings.showFewerSites
              : strings.showAllSites(facets.sites.length)}
          </button>
        )}
      </Section>

      <Section
        title={strings.filterGroups.kinds}
        chosen={query.kinds.length > 0}
        onClear={() => onChange("kinds", [])}
      >
        {group("kinds", facets.kinds, (v) => strings.kindNames[v as LinkKind])}
      </Section>

      {facets.senders.length > 1 && (
        <Section
          title={strings.filterGroups.senders}
          chosen={query.senders.length > 0}
          onClear={() => onChange("senders", [])}
        >
          {group("senders", facets.senders, (v) => v || strings.noSender)}
        </Section>
      )}

      {facets.sources.length > 1 && (
        <Section
          title={strings.filterGroups.sources}
          chosen={query.sources.length > 0}
          onClear={() => onChange("sources", [])}
        >
          {group("sources", facets.sources, (v) => sourceNames.get(v) ?? v)}
        </Section>
      )}

      <Section
        title={strings.filterGroups.dates}
        chosen={query.dates.length > 0}
        onClear={() => onChange("dates", [])}
      >
        {facets.dates.map((year) => {
          const open = openYears.has(year.value);
          const id = `${monthsId}-${year.value}`;
          return (
            <div key={year.value}>
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <Option
                    {...year}
                    label={year.value || strings.noDate}
                    onToggle={() =>
                      onChange("dates", toggled(query.dates, year.value))
                    }
                  />
                </div>
                {year.months.length > 1 && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={id}
                    aria-label={strings.showMonths(year.value)}
                    className="px-1"
                    onClick={() => {
                      const next = new Set(openYears);
                      if (open) next.delete(year.value);
                      else next.add(year.value);
                      setOpenYears(next);
                    }}
                  >
                    <span aria-hidden>{open ? "▾" : "▸"}</span>
                  </button>
                )}
              </div>
              {open && (
                <div id={id} className="ml-6">
                  {year.months.map((month) => (
                    <Option
                      key={month.value}
                      {...month}
                      label={strings.month(month.value)}
                      onToggle={() =>
                        onChange("dates", toggled(query.dates, month.value))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
