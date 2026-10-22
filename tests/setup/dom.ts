// Testing Library unmounts after each test only when Vitest's globals are on;
// they aren't here, so components from one test would leak into the next.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has <dialog> but not its methods. This stand-in opens and closes it
// and fires "close", which is all the components rely on. Focus trapping,
// Esc and putting focus back are the browser's; they are checked in a real
// browser, not here.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// Nor does jsdom scroll. The virtual list scrolls its container with
// scrollTo and follows "scroll" events; this does both. jsdom lays nothing
// out, so tests give the container a height themselves.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    const top = typeof options === "number" ? undefined : options?.top;
    if (top !== undefined) this.scrollTop = top;
    this.dispatchEvent(new Event("scroll"));
  } as Element["scrollTo"];
}
