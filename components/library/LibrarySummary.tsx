import type { Library } from "@/hooks/useLibrary";
import { strings } from "@/lib/strings";

// One line on what the library holds, until the list arrives (M3).
export function LibrarySummary({ library }: { library: Library }) {
  if (library.status === "failed") {
    return <p role="alert">{strings.libraryFailed(library.message)}</p>;
  }
  if (library.status === "loading" || library.rows.count === 0) return null;
  const { rows } = library;
  return (
    <p>{strings.library(rows.count, rows.keyCount, rows.domainNames.length)}</p>
  );
}
