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
