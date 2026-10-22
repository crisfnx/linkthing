// A synthetic export shaped like a real one: mostly bare links, some notes,
// media, multi-line messages; one message a minute.
export function syntheticExport(targetLength: number): string {
  const bodies = [
    "https://x.com/exampledev/status/{n}?s=20&t=AbCdEfGhIjKlMnOpQrStUv",
    "https://www.reddit.com/r/webdev/s/{n}",
    "https://youtube.com/shorts/{n}?si=AbCdEfGhIjKlMnOp",
    "https://www.instagram.com/reel/{n}/?igsh=MWxhYmNkZWZnaGlqaw==",
    "Recipe for the weekend, double the garlic",
    "<Media omitted>",
    "Good write-up on caching https://dev.to/exampledev/post-{n}",
    "Notes for later\nsecond line\nhttps://example.com/list/{n}",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines: string[] = [];
  let length = 0;
  for (let n = 0; length < targetLength; n++) {
    const d = new Date(Date.UTC(2020, 0, 1) + n * 60_000);
    const header = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} - Cris: `;
    const line =
      header + (bodies[n % bodies.length] ?? "").replace("{n}", String(n));
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}
