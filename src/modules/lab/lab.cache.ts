import { createClient } from "redis";

type MemoryRecord = {
  value: string;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryRecord>();
let redisClient: ReturnType<typeof createClient> | null = null;
let redisInit: Promise<void> | null = null;

async function ensureRedis(url: string) {
  if (!url.trim()) return;
  if (redisClient?.isOpen) return;
  if (redisInit) return redisInit;

  redisInit = (async () => {
    const client = createClient({ url });
    client.on("error", () => {
      // Swallow Redis errors and keep memory fallback working.
    });
    await client.connect();
    redisClient = client;
  })().finally(() => {
    redisInit = null;
  });

  return redisInit;
}

export async function cacheGet<T>(key: string, redisUrl: string): Promise<T | null> {
  try {
    await ensureRedis(redisUrl);
    if (redisClient?.isOpen) {
      const raw = await redisClient.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
  } catch {
    // Fall through to memory cache.
  }

  const inMemory = memoryCache.get(key);
  if (!inMemory) return null;
  if (Date.now() > inMemory.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  try {
    return JSON.parse(inMemory.value) as T;
  } catch {
    memoryCache.delete(key);
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
  redisUrl: string
): Promise<void> {
  const serialized = JSON.stringify(value);
  const ttl = Math.max(30, ttlSeconds);

  try {
    await ensureRedis(redisUrl);
    if (redisClient?.isOpen) {
      await redisClient.set(key, serialized, { EX: ttl });
      return;
    }
  } catch {
    // Fall back to memory cache.
  }

  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttl * 1000,
  });
}

export async function cacheDel(key: string, redisUrl: string): Promise<void> {
  try {
    await ensureRedis(redisUrl);
    if (redisClient?.isOpen) {
      await redisClient.del(key);
    }
  } catch {
    // Ignore cache delete errors.
  }
  memoryCache.delete(key);
}
