import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { readRaw, subscribe, writeRaw } from "./storage";

type Updater<T> = T | ((previous: T) => T);

/** Turn saved text back into a value, or fall back to `initial` if it is not usable. */
function parseOr<T>(raw: string | null, initial: T, isValid?: (value: unknown) => value is T): T {
  if (raw === null) return initial;
  try {
    const value: unknown = JSON.parse(raw);
    if (isValid && !isValid(value)) return initial;
    return value as T;
  } catch {
    return initial; // the text was not valid JSON
  }
}

/**
 * Like useState, but the value is saved in localStorage and shared.
 *
 *  - It is remembered after a reload.
 *  - Every component using the same `key` stays in step (same tab and other tabs).
 *  - If the browser refuses to save, it keeps working until the page closes.
 *  - Pass `isValid` to reject saved data of the wrong type (use a function that
 *    is defined outside the component, so it stays the same between renders).
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
  isValid?: (value: unknown) => value is T,
): [T, (next: Updater<T>) => void] {
  // Remember the FIRST initial value, so passing `[]` or `{}` inline each
  // render does not look like a change.
  const [initialValue] = useState(initial);

  const subscribeToKey = useCallback((onChange: () => void) => subscribe(key, onChange), [key]);
  const getSnapshot = useCallback(() => readRaw(key), [key]);

  // The snapshot is plain text, so React can compare it safely.
  // The last argument is what the server (and hydration) sees: nothing saved.
  const raw = useSyncExternalStore(subscribeToKey, getSnapshot, () => null);

  const value = useMemo(() => parseOr(raw, initialValue, isValid), [raw, initialValue, isValid]);

  const setValue = useCallback(
    (next: Updater<T>) => {
      // Read the CURRENT saved value, so two updates in a row both count.
      const current = parseOr(readRaw(key), initialValue, isValid);
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(current) : next;
      writeRaw(key, JSON.stringify(resolved));
    },
    [key, initialValue, isValid],
  );

  return [value, setValue];
}
