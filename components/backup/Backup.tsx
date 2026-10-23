"use client";

import { useRef, useState } from "react";
import { backupFileName } from "@/lib/backup/format";
import type { Restored } from "@/lib/backup/restore";
import { saveFile } from "@/lib/export/scope";
import type { ImportProgress } from "@/lib/import/options";
import { strings } from "@/lib/strings";
import { WorkerError, type ExtractClient } from "@/lib/workers/client";

const button =
  "rounded-md border border-current/40 px-2.5 py-1 text-sm font-medium aria-disabled:opacity-50";

type Status =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

function Said({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  return (
    <p role={status.kind === "failed" ? "alert" : "status"} className="text-sm">
      {status.text}
    </p>
  );
}

// "Download a backup" (§6.5): the worker writes the whole library as one
// file, and the browser saves it.
export function DownloadBackup({
  connect,
  busy = false,
}: {
  connect: () => ExtractClient;
  busy?: boolean; // an import is running: wait for it
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const running = status.kind === "running";

  async function download() {
    if (busy || running) return;
    setStatus({ kind: "running", text: strings.backup.preparing });
    try {
      const { file, counts } = await connect().backup();
      const name = backupFileName();
      saveFile(file, name);
      setStatus({
        kind: "done",
        text: strings.backup.saved(name, counts.sources, counts.links),
      });
    } catch {
      setStatus({ kind: "failed", text: strings.backup.failed });
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={button}
        aria-disabled={busy || running}
        onClick={() => void download()}
      >
        {strings.backup.download}
      </button>
      <Said status={status} />
    </div>
  );
}

function outcome({ sources, links, stars, alreadyHere }: Restored): string {
  if (sources === 0) return strings.backup.nothingNew(alreadyHere);
  const restored = strings.backup.restored(sources, links, stars);
  return alreadyHere > 0
    ? `${restored} ${strings.backup.alreadyHere(alreadyHere)}`
    : restored;
}

function progressText({ phase, done, total }: ImportProgress): string {
  return phase === "saving" && done !== undefined && total !== undefined
    ? strings.backup.restoring(done, total)
    : strings.backup.checking;
}

// "Restore from a backup" (§6.5): the worker checks the whole file, then
// adds what's missing in one transaction, with progress and Cancel. The
// library shows the result as soon as it's saved.
export function RestoreBackup({
  connect,
  busy = false,
  onRunning,
}: {
  connect: () => ExtractClient;
  busy?: boolean; // an import is running: wait for it
  onRunning?: (running: boolean) => void; // so imports wait for this
}) {
  const files = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const running = status.kind === "running";

  async function restore(file: File) {
    onRunning?.(true);
    setStatus({ kind: "running", text: strings.backup.checking });
    try {
      const restored = await connect().restore(file, (progress) =>
        setStatus({ kind: "running", text: progressText(progress) }),
      );
      setStatus({ kind: "done", text: outcome(restored) });
    } catch (error) {
      const code = error instanceof WorkerError ? error.code : "unexpected";
      setStatus({
        kind: "failed",
        text:
          code === "invalid-backup"
            ? (error as Error).message
            : code === "cancelled"
              ? strings.backup.cancelled
              : strings.backup.restoreFailed,
      });
    } finally {
      onRunning?.(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          aria-disabled={busy || running}
          onClick={() => {
            if (!busy && !running) files.current?.click();
          }}
        >
          {strings.backup.restore}
        </button>
        {running && (
          <button
            type="button"
            className={button}
            onClick={() => connect().cancel()}
          >
            {strings.backup.cancel}
          </button>
        )}
      </div>
      <input
        ref={files}
        type="file"
        accept=".gz,.jsonl,application/gzip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The same file can be chosen again, after a failure.
          event.target.value = "";
          if (file) void restore(file);
        }}
      />
      <Said status={status} />
    </div>
  );
}
