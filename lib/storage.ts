// The browser's storage for this site (PRD §6.4, §15): how much LinkVault
// uses, and whether the browser has agreed to keep it. Without that, a
// browser may clear it when space runs low, and Safari after seven days
// without a visit. Each call is undefined where the browser lacks the API.
export interface StorageUse {
  usage: number; // bytes
  quota: number; // bytes the browser would allow
}

export async function storageUse(): Promise<StorageUse | undefined> {
  const estimate = await globalThis.navigator?.storage?.estimate?.();
  if (estimate?.usage === undefined || estimate.quota === undefined) {
    return undefined;
  }
  return { usage: estimate.usage, quota: estimate.quota };
}

export async function isPersisted(): Promise<boolean | undefined> {
  return globalThis.navigator?.storage?.persisted?.();
}

// Chrome and Safari answer on their own, from how the site is used; Firefox
// asks the user. Asked after the first import, and from Settings.
export async function askToPersist(): Promise<boolean | undefined> {
  try {
    return await globalThis.navigator?.storage?.persist?.();
  } catch {
    return undefined;
  }
}
