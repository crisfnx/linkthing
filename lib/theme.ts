// Settings → Theme (§6.7) on the page: a data-theme attribute on <html>,
// none to follow the system (app/globals.css). The settings in IndexedDB are
// the record, but they're read only after the page has painted, so a copy
// in localStorage lets the layout's script set the theme before it does.
export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "linkvault-theme";

// Inline in <head> (app/layout.tsx), so it runs before the first paint.
export const themeScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies once the settings are read.
  }
}
