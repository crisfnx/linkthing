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
