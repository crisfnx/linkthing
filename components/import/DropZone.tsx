"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { strings } from "@/lib/strings";

interface Props {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
  children: ReactNode;
}

// The whole page accepts drops (§6.1): files, or text dragged from another
// app. The browser's own handling is always prevented, so a file dropped
// during an import doesn't replace the page.
export function DropZone({ disabled, onFiles, onText, children }: Props) {
  const [dragging, setDragging] = useState(false);

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
    else onText(event.dataTransfer.getData("text/plain"));
  }

  return (
    <div
      className="flex min-h-full flex-1 flex-col"
      onDragEnter={() => setDragging(!disabled)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        const to = event.relatedTarget;
        if (!(to instanceof Node && event.currentTarget.contains(to))) {
          setDragging(false);
        }
      }}
      onDrop={drop}
      data-testid="drop-zone"
    >
      {children}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-3 flex items-center justify-center rounded-xl border-4 border-dashed border-current bg-background/90 text-2xl font-semibold"
        >
          {strings.dropHere}
        </div>
      )}
    </div>
  );
}
