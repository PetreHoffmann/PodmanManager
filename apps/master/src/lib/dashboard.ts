/** Total of the volumes over all hosts (count and bytes); hosts without an answer are counted separately. */
export function sumVolumes(storage: ({ volumes: { count: number; size: number } } | null)[]): { count: number; size: number; missing: number } {
  let count = 0, size = 0, missing = 0;
  for (const s of storage) {
    if (!s) { missing++; continue; }
    count += s.volumes.count;
    size += s.volumes.size;
  }
  return { count, size, missing };
}

/** Disk space of the images over all hosts (as `podman system df` counts it: shared layers once per host); hosts without an answer are counted separately. */
export function sumImages(storage: ({ images: { size: number } } | null)[]): { size: number; missing: number } {
  let size = 0, missing = 0;
  for (const s of storage) {
    if (!s) { missing++; continue; }
    size += s.images.size;
  }
  return { size, missing };
}

/** Items of all hosts whose list could be read, and how many hosts could not be read. */
export function countLists(results: ({ ok: true; data: unknown[] } | { ok: false })[]): { count: number; missing: number } {
  let count = 0, missing = 0;
  for (const r of results) {
    if (r.ok) count += r.data.length;
    else missing++;
  }
  return { count, missing };
}
