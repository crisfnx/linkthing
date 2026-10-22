import type { ReactNode } from "react";
import type { LinkKind } from "@/lib/extract/types";

// One small glyph per kind (§6.2), drawn in the text colour. Decorative: the
// row says the kind in words for screen readers.
const SHAPES: Record<LinkKind, ReactNode> = {
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  social: <path d="M4 5h16v11H9l-5 4z" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>
  ),
  document: <path d="M6 3h8l4 4v14H6zM9 12h6M9 16h6" />,
  audio: (
    <>
      <path d="M9 17V5l10-2v12" />
      <circle cx="6.5" cy="17" r="2.5" />
      <circle cx="16.5" cy="15" r="2.5" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
};

export function KindIcon({
  kind,
  className,
}: {
  kind: LinkKind;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {SHAPES[kind]}
    </svg>
  );
}
