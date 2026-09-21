import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => cleanup());

// jsdom implements no layout: report a desktop-sized viewport so the
// virtualizer and the ResizeObserver-driven column count behave.
const fakeRect = {
  x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800,
  toJSON: () => ({}),
};
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 1200 },
  clientHeight: { configurable: true, get: () => 800 },
  offsetWidth: { configurable: true, get: () => 1200 },
  offsetHeight: { configurable: true, get: () => 800 },
  scrollHeight: { configurable: true, get: () => 800 },
  getBoundingClientRect: {
    configurable: true,
    value: () => ({ ...fakeRect }),
  },
});

// jsdom does not implement ResizeObserver; a stub that fires once on observe is
// enough for the layout hooks under test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    private callback: (entries: Array<{ target: Element }>) => void;
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ target }]);
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}