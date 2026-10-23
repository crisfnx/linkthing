// Settings (PRD §6.7). The row holds only what the user changed; reading
// fills in the rest from defaults, so the default day/month order follows
// the browser's language until one is chosen.
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Settings, StoredSettings } from "@/lib/db/types";
import { dateOrderFor } from "@/lib/locale";

// The settings built so far; the rest of Settings joins as its milestone
// lands (previews in M7, AI in M8, tracking rules in Phase 1.5).
export type UserSettings = Pick<
  Settings,
  "theme" | "defaultDateOrder" | "findBareDomains" | "dedupeByDefault"
>;

export const THEMES: readonly UserSettings["theme"][] = [
  "system",
  "light",
  "dark",
];

export function defaultSettings(
  language = globalThis.navigator?.language ?? "en",
): UserSettings {
  return {
    theme: "system",
    defaultDateOrder: dateOrderFor(language),
    findBareDomains: true,
    dedupeByDefault: false,
  };
}

function isStoredSettings(row: unknown): row is StoredSettings {
  return (row as { key?: unknown } | undefined)?.key === "settings";
}

export async function readSettings(
  db: LinkVaultDb,
  language?: string,
): Promise<UserSettings> {
  const row = await db.settings.get("settings");
  const stored: Partial<StoredSettings> = isStoredSettings(row) ? row : {};
  const defaults = defaultSettings(language);
  return {
    theme: stored.theme ?? defaults.theme,
    defaultDateOrder: stored.defaultDateOrder ?? defaults.defaultDateOrder,
    findBareDomains: stored.findBareDomains ?? defaults.findBareDomains,
    dedupeByDefault: stored.dedupeByDefault ?? defaults.dedupeByDefault,
  };
}

// Stores the change alone, over what the row already holds.
export async function saveSettings(
  db: LinkVaultDb,
  change: Partial<UserSettings>,
): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    const row = await db.settings.get("settings");
    await db.settings.put({
      ...(isStoredSettings(row) ? row : {}),
      ...change,
      key: "settings",
    });
  });
}
