/** Hashes already started, by File object, so the profile restore and the stem panel read each file's bytes once. */
const hashes = new WeakMap<File, Promise<string>>();

/** SHA-256 of the file's bytes as lowercase hex. Matching saved stems is by content, not by name. */
export function hashFile(file: File): Promise<string> {
  const known = hashes.get(file);
  if (known) return known;
  const started = (async () => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  })();
  hashes.set(file, started);
  // A failure is not remembered, so a later attempt can succeed.
  started.catch(() => {
    if (hashes.get(file) === started) hashes.delete(file);
  });
  return started;
}

/**
 * SHA-256 hex of a YouTube take's link, as the key its alignment is saved under. The desktop store wants 64
 * lowercase hex characters; the `youtube:` prefix keeps it apart from the hash of any file's bytes.
 */
export async function hashVideoLink(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`youtube:${url}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
