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
