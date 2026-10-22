// The chat behind "Try with sample data" (PRD §6.1). It's made up, and served
// from public/ on click, so it adds nothing to the page's JavaScript. The file
// name gives the source its name, as an export's does.
export const SAMPLE_URL = "/sample-chat.txt";
export const SAMPLE_FILE_NAME = "WhatsApp Chat with Sample chat.txt";

export async function loadSample(): Promise<File> {
  const response = await fetch(SAMPLE_URL);
  if (!response.ok) throw new Error(`${SAMPLE_URL}: ${response.status}`);
  return new File([await response.blob()], SAMPLE_FILE_NAME, {
    type: "text/plain",
  });
}
