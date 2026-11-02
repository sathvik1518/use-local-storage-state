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
