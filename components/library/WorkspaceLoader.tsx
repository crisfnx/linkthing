"use client";

import dynamic from "next/dynamic";

// next/dynamic with ssr: false works only inside a Client Component (§8.3),
// hence this loader between the static page and the workspace.
export const WorkspaceLoader = dynamic(() => import("./Workspace"), {
  ssr: false,
});
