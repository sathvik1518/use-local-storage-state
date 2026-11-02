/**
 * A tiny "external store" around localStorage, for useSyncExternalStore.
 *
 * Three jobs:
 *  1. read and write one key safely (the browser may refuse),
 *  2. tell every component in THIS tab when a key changes
 *     (the browser's own `storage` event is NOT sent to the tab that wrote),
 *  3. listen for the `storage` event so changes from OTHER tabs arrive too.
 */

/** Components in this tab that are listening to each key. */
const listeners = new Map<string, Set<() => void>>();

/**
 * Used ONLY when the browser refuses to save (private mode, quota full,
 * blocked by settings). The setting then still works until the page closes.
 */
const fallback = new Map<string, string>();

/** `window.localStorage` can THROW just by being touched, so guard it. */
function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved text for a key, or null when nothing is saved or reading fails. */
export function readRaw(key: string): string | null {
  const kept = fallback.get(key);
  if (kept !== undefined) return kept;
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Save text for a key, then tell every component in this tab. */
export function writeRaw(key: string, raw: string): void {
  try {
    const storage = getStorage();
    if (!storage) throw new Error("storage unavailable");
    storage.setItem(key, raw);
    fallback.delete(key); // real storage works again, so it is the truth
  } catch {
    fallback.set(key, raw); // keep it in memory so the screen still follows
  }
  listeners.get(key)?.forEach((notify) => notify());
}

/**
 * Start listening to one key. Returns a function that stops listening.
 * Matches the `subscribe` shape that useSyncExternalStore expects.
 */
export function subscribe(key: string, onChange: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(onChange);

  const onStorage = (event: StorageEvent) => {
    // Events from sessionStorage are not ours.
    const storage = getStorage();
    if (event.storageArea && storage && event.storageArea !== storage) return;
    // `key === null` means "everything was cleared", so it concerns us too.
    if (event.key !== null && event.key !== key) return;
    fallback.delete(key); // another tab wrote the real value, so forget our memory copy
    onChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set.delete(onChange);
    if (set.size === 0) listeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}
