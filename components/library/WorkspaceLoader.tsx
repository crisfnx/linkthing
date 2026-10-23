"use client";

import dynamic from "next/dynamic";
import { FirstScreenShell } from "@/components/import/Intro";

// next/dynamic with ssr: false works only inside a Client Component (§8.3),
// hence this loader between the static page and the workspace. Its loading
// state is the page's static HTML: the first screen's intro (§8.6).
export const WorkspaceLoader = dynamic(() => import("./Workspace"), {
  ssr: false,
  loading: () => <FirstScreenShell />,
});
