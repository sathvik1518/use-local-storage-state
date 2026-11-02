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
