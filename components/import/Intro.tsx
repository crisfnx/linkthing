import { strings } from "@/lib/strings";

// The first screen's heading, what LinkVault does, and the privacy line (§7).
export function Intro() {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold">{strings.appName}</h1>
      <p className="text-lg">{strings.tagline}</p>
      <p className="text-sm opacity-70">{strings.privacy}</p>
    </header>
  );
}

export const FIRST_SCREEN =
  "mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10";

// The page's static HTML until the workspace has loaded and read the library
// (§8.6): the first screen's intro, so its largest text paints before any
// script runs. A browser that already holds a library has it hidden before
// the first paint (lib/shell.ts), so a reload doesn't flash it.
export function FirstScreenShell() {
  return (
    <main className={FIRST_SCREEN} data-shell>
      <Intro />
    </main>
  );
}
