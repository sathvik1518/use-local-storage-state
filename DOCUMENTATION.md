# useLocalStorageState: A Saved Setting That Stays in Step

**Day 34 Mini Capstone, Custom Hooks**  
**Project folder:** `use-local-storage-state`

---

## 1. Goal

The Orders page has a checkbox, "Check for new orders every 15 seconds". The setting should:

- **remember its value** after a reload,
- **stay in step** with any other component that uses the same key,
- **follow a change made in another tab**,
- **survive a browser that refuses to save** (private mode, full storage, blocked by settings).

The task (Day 34 Deep Dive, Mini Capstone) was to write a custom hook that does all four. It works like `useState`, but the value is saved and shared.

Think of a notice board in a shop. Everyone reads the same board, and when one person changes a notice, everyone sees it. If the board is locked, the staff keep a note in their pocket until it is fixed.

---

## 2. Tools

| Tool | Role |
|---|---|
| React + TypeScript (strict) | The hook, the screens and the types |
| `useSyncExternalStore` | The React way to read data that lives outside React (here: localStorage) |
| Vite | Dev server and build |
| Vitest + jsdom | Test runner and fake browser |
| React Testing Library + user-event | Render components and act like a user |

---

## 3. Project structure

```
use-local-storage-state/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── .gitignore
├── README.md
├── DOCUMENTATION.md
└── src/
    ├── storage.ts                    (safe read/write, same-tab and cross-tab updates)
    ├── useLocalStorageState.ts       (the capstone hook)
    ├── OrdersPage.tsx                (the checkbox, plus a second reader of the same key)
    ├── App.tsx
    ├── main.tsx
    ├── useLocalStorageState.test.tsx (25 tests)
    └── test/
        └── setup.ts                  (rules for every test)
```

---

## 4. Setup commands

```bash
mkdir use-local-storage-state
cd use-local-storage-state
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript vitest jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @types/react @types/react-dom @types/node
```

**`package.json` scripts**

```json
"dev": "vite",
"build": "vite build",
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

---

## 5. The idea: three kinds of change

```
   Component A ─┐                                    ┌─ Component B   (same key)
                ├── useLocalStorageState("key") ─────┤
   Component C ─┘            │                       └─ ...
                             │ reads / writes
                      ┌──────▼───────┐
                      │ localStorage │  ◀── other tab writes ── "storage" event
                      └──────────────┘
                 (if it refuses: a copy kept in memory)
```

| Who changed it | How the hook finds out |
|---|---|
| This component | It wrote the value itself |
| Another component in **this** tab | `storage.ts` tells every listener for that key. The browser does **not** send a `storage` event to the tab that made the change. |
| **Another tab** | The browser's `storage` event. The hook listens for it. |
| The browser refuses to save | The value is kept in memory, so the screen still follows. |

---

## 6. The code

### `src/storage.ts` (the safe storage layer)

```ts
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
```

### `src/useLocalStorageState.ts` (the capstone hook)

```ts
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
```

### `src/OrdersPage.tsx`

```tsx
import { useLocalStorageState } from "./useLocalStorageState";

export const AUTO_REFRESH_KEY = "orders:autoRefresh";

// Defined outside the components, so it is the same function every render.
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** The setting, shared by every component that calls it. */
export function useAutoRefresh() {
  return useLocalStorageState(AUTO_REFRESH_KEY, false, isBoolean);
}

/** A second component using the same key, to show they stay in step. */
export function RefreshBadge() {
  const [autoRefresh] = useAutoRefresh();
  return <p role="status">Auto-refresh is {autoRefresh ? "on" : "off"}.</p>;
}

export default function OrdersPage() {
  const [autoRefresh, setAutoRefresh] = useAutoRefresh();

  return (
    <main>
      <h1>Orders</h1>
      <label>
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(event) => setAutoRefresh(event.target.checked)}
        />{" "}
        Check for new orders every 15 seconds
      </label>
    </main>
  );
}
```

### `src/App.tsx`

```tsx
import OrdersPage, { RefreshBadge } from "./OrdersPage";

export default function App() {
  return (
    <>
      <header style={{ padding: 12, borderBottom: "1px solid #d0d7de" }}>
        <RefreshBadge />
      </header>
      <OrdersPage />
      <p style={{ padding: 12 }}>
        Tip: open this page in two tabs. Tick the box in one tab and watch the other follow.
      </p>
    </>
  );
}
```

### `src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `vite.config.ts` (test setup)

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

### Design decisions

| Decision | Reason |
|---|---|
| `useSyncExternalStore` instead of `useState` + `useEffect` | The value lives outside React. This hook is built for that case. It avoids the flash of a wrong value and works with Strict Mode and server rendering. |
| The snapshot is the **raw text**, not the parsed value | React compares snapshots to decide when to re-render. Text compares safely. A freshly parsed object would look "new" every time and loop. |
| Parse in `useMemo`, keyed on the text | The parsed value only changes when the saved text changes. |
| A list of listeners per key, inside `storage.ts` | The browser does not send `storage` events to the tab that wrote. Without this, two components in the same tab would not stay in step. |
| A `storage` listener per subscriber, removed on cleanup | Other tabs are covered, and nothing is left behind when a component goes away. A test counts adds and removes. |
| `event.key === null` counts as a change | `localStorage.clear()` sends an event with a null key. Ignoring it would leave a stale value on screen. |
| Events from `sessionStorage` are ignored | They share the same event type, but they are not our data. |
| Every `localStorage` access is inside `try/catch` | In some browsers just touching `window.localStorage` throws (blocked cookies, privacy modes). Reads fall back to the initial value. |
| A memory `fallback` when saving fails | The setting keeps working until the page closes, and all components stay in step. |
| The fallback is dropped when another tab writes | Another tab's real saved value is newer than our memory copy, so it wins. |
| Optional `isValid` check | Old or wrong data (for example `"yes"` where a boolean is expected) is ignored instead of breaking the page. |
| First `initial` value is remembered | Passing `[]` or `{}` inline each render would otherwise look like a change. |
| Updater reads the **current saved value** | Two updates in a row (`n => n + 1` twice) both count, like `useState`. |
| Server snapshot is `null` | On the server there is no storage, so the initial value is shown and the page hydrates cleanly. |
| `isValid` must be defined outside the component | A new function each render would re-run the parsing every time. It is noted in the hook's comment. |

---

## 7. Tests (25 tests)

The tests have five groups. Failures of the browser (blocked or full storage) are simulated by replacing `Storage.prototype.getItem` and `setItem`. Another tab is simulated by changing `localStorage` and sending a `StorageEvent`, because jsdom has only one window.

| # | Test | What it proves |
|---|---|---|
| 1 | Returns the initial value when nothing is saved | Default works |
| 2 | Reads a value saved earlier | Reading works |
| 3 | Saves the value in localStorage as JSON | Writing works |
| 4 | Updater function, two updates in a row both count | Same behaviour as `useState` |
| 5 | Remembers after a reload (unmount, mount again) | Goal 1: remembers |
| 6 | Two components, same key, same tab, stay in step | Goal 2: stays in step |
| 7 | Different keys are independent | No cross-talk |
| 8 | Follows a change made in another tab | Goal 3: other tabs |
| 9 | Another tab clears everything (null key) | `clear()` handled |
| 10 | Ignores events for a different key | No needless re-reads |
| 11 | Ignores events from `sessionStorage` | Right storage only |
| 12 | Saved text is not valid JSON | Falls back safely |
| 13 | Saved data has the wrong type | Validation works |
| 14 | Browser refuses to read | No crash |
| 15 | Browser refuses to save, components still in step | Goal 4: survives a refusing browser |
| 16 | After a failed save, another tab's real value wins | Memory copy does not get stuck |
| 17 | Key changes, value is re-read | Dynamic keys work |
| 18 | Storage listener removed on unmount | No leaks |
| 19 | Works in StrictMode | Safe in development |
| 20 | Server render shows the initial value | No storage on the server is fine |
| 21 to 25 | Orders page: starts unchecked, remembers after reload, second component follows, follows another tab, ignores wrong saved data | The capstone, end to end |

### `src/test/setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  window.localStorage.clear();
});

// After every test: clean the screen and undo any fake "storage is broken" setup.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
```

### `src/useLocalStorageState.test.tsx`

```tsx
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OrdersPage, { AUTO_REFRESH_KEY, RefreshBadge } from "./OrdersPage";
import { useLocalStorageState } from "./useLocalStorageState";

// Each test gets its own key, so the in-memory fallback never leaks between tests.
let counter = 0;
const newKey = () => `test-key-${++counter}`;

/** Pretend another tab wrote to localStorage: change it, then send the event. */
function otherTabWrites(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  window.localStorage.setItem(key, raw);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: raw, storageArea: window.localStorage }),
    );
  });
}

const isNumber = (v: unknown): v is number => typeof v === "number";

describe("useLocalStorageState: remembering", () => {
  it("returns the initial value when nothing is saved", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, "light"));
    expect(result.current[0]).toBe("light");
  });

  it("reads a value that was saved earlier", () => {
    const key = newKey();
    window.localStorage.setItem(key, JSON.stringify("dark"));
    const { result } = renderHook(() => useLocalStorageState(key, "light"));
    expect(result.current[0]).toBe("dark");
  });

  it("saves the value in localStorage as JSON", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, { on: false }));
    act(() => result.current[1]({ on: true }));
    expect(result.current[0]).toEqual({ on: true });
    expect(window.localStorage.getItem(key)).toBe('{"on":true}');
  });

  it("supports an updater function, and two updates in a row both count", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, 0));
    act(() => {
      result.current[1]((n) => n + 1);
      result.current[1]((n) => n + 1);
    });
    expect(result.current[0]).toBe(2);
  });

  it("remembers the value after a reload (unmount, then mount again)", () => {
    const key = newKey();
    const first = renderHook(() => useLocalStorageState(key, false));
    act(() => first.result.current[1](true));
    first.unmount();

    const second = renderHook(() => useLocalStorageState(key, false));
    expect(second.result.current[0]).toBe(true);
  });
});

describe("useLocalStorageState: staying in step", () => {
  it("keeps two components with the same key in step, in the same tab", () => {
    const key = newKey();
    const a = renderHook(() => useLocalStorageState(key, 0));
    const b = renderHook(() => useLocalStorageState(key, 0));

    act(() => a.result.current[1](5));

    expect(a.result.current[0]).toBe(5);
    expect(b.result.current[0]).toBe(5);
  });

  it("keeps different keys independent", () => {
    const keyA = newKey();
    const keyB = newKey();
    const a = renderHook(() => useLocalStorageState(keyA, 0));
    const b = renderHook(() => useLocalStorageState(keyB, 0));

    act(() => a.result.current[1](5));

    expect(a.result.current[0]).toBe(5);
    expect(b.result.current[0]).toBe(0);
  });

  it("follows a change made in another tab", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, false));

    otherTabWrites(key, true);

    expect(result.current[0]).toBe(true);
  });

  it("goes back to the initial value when another tab clears everything", () => {
    const key = newKey();
    window.localStorage.setItem(key, "true");
    const { result } = renderHook(() => useLocalStorageState(key, false));
    expect(result.current[0]).toBe(true);

    window.localStorage.clear();
    act(() => {
      // A clear() event has a null key.
      window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: window.localStorage }));
    });

    expect(result.current[0]).toBe(false);
  });

  it("ignores storage events for a different key", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, false));
    window.localStorage.setItem(key, "true"); // changed quietly, no event for OUR key

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "some-other-key", storageArea: window.localStorage }),
      );
    });

    expect(result.current[0]).toBe(false);
  });

  it("ignores storage events that come from sessionStorage", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, false));
    window.localStorage.setItem(key, "true");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: "true", storageArea: window.sessionStorage }),
      );
    });

    expect(result.current[0]).toBe(false);
  });
});

describe("useLocalStorageState: when the data or the browser misbehaves", () => {
  it("uses the initial value when the saved text is not valid JSON", () => {
    const key = newKey();
    window.localStorage.setItem(key, "{not json");
    const { result } = renderHook(() => useLocalStorageState(key, "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("uses the initial value when the saved data has the wrong type", () => {
    const key = newKey();
    window.localStorage.setItem(key, JSON.stringify("not a number"));
    const { result } = renderHook(() => useLocalStorageState(key, 7, isNumber));
    expect(result.current[0]).toBe(7);
  });

  it("does not crash when the browser refuses to READ (blocked storage)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, "safe"));
    expect(result.current[0]).toBe("safe");
  });

  it("keeps working when the browser refuses to SAVE, and components stay in step", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const key = newKey();
    const a = renderHook(() => useLocalStorageState(key, false));
    const b = renderHook(() => useLocalStorageState(key, false));

    expect(() => act(() => a.result.current[1](true))).not.toThrow();

    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(true);
  });

  it("lets another tab's real value win after a failed save", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, "start"));
    act(() => result.current[1]("kept in memory"));
    expect(result.current[0]).toBe("kept in memory");

    setItem.mockRestore(); // storage works again, and another tab writes
    otherTabWrites(key, "from other tab");

    expect(result.current[0]).toBe("from other tab");
  });
});

describe("useLocalStorageState: React details", () => {
  it("re-reads when the key changes", () => {
    const keyA = newKey();
    const keyB = newKey();
    window.localStorage.setItem(keyA, JSON.stringify("A value"));
    window.localStorage.setItem(keyB, JSON.stringify("B value"));

    const { result, rerender } = renderHook(({ k }) => useLocalStorageState(k, "none"), {
      initialProps: { k: keyA },
    });
    expect(result.current[0]).toBe("A value");

    rerender({ k: keyB });
    expect(result.current[0]).toBe("B value");
  });

  it("removes its storage listener when the component goes away", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const key = newKey();
    const { unmount } = renderHook(() => useLocalStorageState(key, 0));
    unmount();

    const added = add.mock.calls.filter(([type]) => type === "storage").length;
    const removed = remove.mock.calls.filter(([type]) => type === "storage").length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  it("works inside StrictMode", () => {
    const key = newKey();
    const { result } = renderHook(() => useLocalStorageState(key, 1), { wrapper: StrictMode });
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
  });

  it("renders the initial value on the server, where there is no storage", () => {
    const key = newKey();
    function Probe() {
      const [value] = useLocalStorageState(key, "server-safe");
      return <p>{value}</p>;
    }
    expect(renderToString(<Probe />)).toContain("server-safe");
  });
});

describe("Orders page: the capstone", () => {
  it("starts unchecked and shows 'off'", () => {
    render(<OrdersPage />);
    expect(screen.getByLabelText("Check for new orders every 15 seconds")).not.toBeChecked();
  });

  it("remembers the checkbox after a reload", async () => {
    const user = userEvent.setup();
    const first = render(<OrdersPage />);
    await user.click(screen.getByLabelText("Check for new orders every 15 seconds"));
    first.unmount();

    render(<OrdersPage />);
    expect(screen.getByLabelText("Check for new orders every 15 seconds")).toBeChecked();
    expect(window.localStorage.getItem(AUTO_REFRESH_KEY)).toBe("true");
  });

  it("keeps another component using the same key in step", async () => {
    const user = userEvent.setup();
    render(
      <>
        <RefreshBadge />
        <OrdersPage />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Auto-refresh is off.");

    await user.click(screen.getByLabelText("Check for new orders every 15 seconds"));

    expect(screen.getByRole("status")).toHaveTextContent("Auto-refresh is on.");
  });

  it("follows a change made in another tab", () => {
    render(<OrdersPage />);
    otherTabWrites(AUTO_REFRESH_KEY, true);
    expect(screen.getByLabelText("Check for new orders every 15 seconds")).toBeChecked();
  });

  it("ignores saved data of the wrong type and still works", async () => {
    window.localStorage.setItem(AUTO_REFRESH_KEY, JSON.stringify("yes"));
    const user = userEvent.setup();
    render(<OrdersPage />);
    const box = screen.getByLabelText("Check for new orders every 15 seconds");
    expect(box).not.toBeChecked();

    await user.click(box);
    expect(box).toBeChecked();
  });
});
```

---

## 8. Results

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | No errors |
| Tests | `npm test` | **25 passed** |
| Build | `npm run build` | Built successfully |
| Break-it check 1 | Stopped listening to the `storage` event | **5 tests failed** |
| Break-it check 2 | Let a failed save crash instead of using the memory copy | **2 tests failed** |
| Break-it check 3 | Skipped the type check on saved data | **2 tests failed** |
| Break-it check 4 | Stopped telling other components in the same tab | **9 tests failed** |
| Restored original | Type check and tests | No errors, 25 passed |

---

## 9. Problems avoided

| Problem | Cause | Fix |
|---|---|---|
| Two components in one tab out of step | The browser sends `storage` events only to OTHER tabs | `storage.ts` keeps its own list of listeners per key |
| Infinite re-render loop | `getSnapshot` returned a freshly parsed object each time | The snapshot is the raw text; parsing happens in `useMemo` |
| Crash in private mode or blocked storage | `window.localStorage` can throw when touched | Every access is wrapped in `try/catch`, with a memory fallback |
| Stale value after `localStorage.clear()` | The event has a `null` key, which a simple `key ===` check skips | `null` key is treated as "this key changed too" |
| Listener leak | A `storage` listener added and never removed | Cleanup removes it. A test counts adds and removes |

---

## 10. What was practiced

- Building a custom hook that wraps something outside React with `useSyncExternalStore`.
- Knowing why `getSnapshot` must return a stable value (text, not a new object).
- Handling the three ways a value can change: this component, another component in the same tab, another tab.
- Knowing that the `storage` event is not sent to the tab that made the change, and that `clear()` sends a `null` key.
- Designing a fallback so the feature degrades gracefully when the browser refuses.
- Validating data read from outside, instead of trusting it.
- Testing browser failures by replacing `Storage` methods, and other tabs by sending a `StorageEvent`.
- Checking that tests are real by breaking the code on purpose and watching them fail.

---

## 11. Known limit

Data is saved as JSON, so values like `undefined`, functions and `Date` objects do not round trip. The memory fallback is lost when the page closes, and it is not shared between tabs, because no storage is available to share. Two tabs that both write at the same moment resolve by "last write wins".

---

## 12. How to run it

```bash
cd use-local-storage-state
npm install
npm test            # 25 tests
npm run typecheck   # type check
npm run dev         # open the link in TWO tabs and tick the box in one
```

In the dev page, tick the box in one tab and the other tab follows. Reload a tab and the setting stays.
