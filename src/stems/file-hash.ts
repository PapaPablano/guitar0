/** SHA-256 of some bytes as lowercase hex. */
async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hashes already started, by File object, so the profile restore and the stem panel read each file's bytes once. */
const hashes = new WeakMap<File, Promise<string>>();

/** SHA-256 of the file's bytes as lowercase hex. Matching saved stems is by content, not by name. */
export function hashFile(file: File): Promise<string> {
  const known = hashes.get(file);
  if (known) return known;
  const started = (async () => sha256Hex(await file.arrayBuffer()))();
  hashes.set(file, started);
  // A failure is not remembered, so a later attempt can succeed.
  started.catch(() => {
    if (hashes.get(file) === started) hashes.delete(file);
  });
  return started;
}
