"use client";

import type {
  ImportPhase,
  ImportProgress as Progress,
} from "@/lib/import/options";
import { strings } from "@/lib/strings";

const PHASES = Object.keys(strings.phases) as ImportPhase[];

interface Props {
  label: string;
  progress: Progress;
  remaining: number;
  onCancel: () => void;
}

// Phase labels, a bar and cancel (§6.1). Saving is the one phase with a count;
// the bar is indeterminate before it. Screen readers hear the phases through
// the Importer's status line, not from here.
export function ImportProgress({
  label,
  progress,
  remaining,
  onCancel,
}: Props) {
  const current = PHASES.indexOf(progress.phase);
  const counted = progress.total !== undefined && progress.total > 0;

  return (
    <section className="flex flex-col gap-3" aria-label={strings.progressLabel}>
      <p className="font-medium">{strings.importing(label, remaining)}</p>
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {PHASES.map((phase, i) => (
          <li
            key={phase}
            aria-current={i === current ? "step" : undefined}
            className={
              i === current ? "font-semibold" : i < current ? "" : "opacity-50"
            }
          >
            {strings.phases[phase]}
          </li>
        ))}
      </ol>
      <progress
        className="w-full"
        aria-label={strings.progressLabel}
        value={counted ? progress.done : undefined}
        max={counted ? progress.total : undefined}
      />
      <div>
        <button
          type="button"
          className="rounded-md border border-current px-3 py-1.5 font-medium"
          onClick={onCancel}
        >
          {strings.cancel}
        </button>
      </div>
    </section>
  );
}
