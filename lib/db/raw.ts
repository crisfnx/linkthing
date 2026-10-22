// SourcePart.raw: the decoded text, gzipped with the built-in CompressionStream
// (PRD §6.4). Chat text compresses several-fold, which matters under Safari's
// storage limits (§15).
export function compressText(text: string): Promise<Blob> {
  const gzipped = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(gzipped).blob();
}

export function decompressText(raw: Blob): Promise<string> {
  const text = raw.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(text).text();
}
