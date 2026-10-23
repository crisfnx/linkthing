// Whether this browser holds a library, known before React runs: the page's
// static HTML is the first screen's intro (FirstScreenShell), which a reload
// of a library shouldn't flash. A copy in localStorage, kept by the
// workspace; app/globals.css hides the shell while it says so.
const STORAGE_KEY = "linkvault-library";

// Inline in <head> (app/layout.tsx), beside the theme's.
export const shellScript = `try{if(localStorage.getItem("${STORAGE_KEY}"))document.documentElement.setAttribute("data-library","")}catch(e){}`;

export function rememberLibrary(hasSources: boolean): void {
  try {
    if (hasSources) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: a reload shows the intro for a moment, nothing worse.
  }
}
