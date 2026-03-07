import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  nexusxServerRedis?: Redis;
};

export async function getServerRedis(): Promise<Redis | null> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  const client = globalForRedis.nexusxServerRedis
    ?? new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

  if (!globalForRedis.nexusxServerRedis) {
    globalForRedis.nexusxServerRedis = client;
  }

  try {
    if (client.status === "wait") {
      await client.connect();
    }
  } catch {
    return null;
  }

  return client;
}
