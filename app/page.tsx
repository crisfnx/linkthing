import { WorkspaceLoader } from "@/components/library/WorkspaceLoader";

// A static shell (§8.2). The workspace needs IndexedDB and a worker, so it
// loads in the browser only.
export default function Home() {
  return <WorkspaceLoader />;
}
