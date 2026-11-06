const TTL_MS = 30_000;

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateCache(prefix: string) {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) store.delete(key);
  }
}
