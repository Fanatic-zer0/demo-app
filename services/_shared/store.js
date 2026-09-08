// Generic per-namespace persistence for demo entities.
// Uses Redis (shared across replicas, backed by a PVC in Kubernetes) when REDIS_URL is set;
// otherwise falls back to an in-memory Map so local dev and unit tests need no Redis at all.
const memoryNamespaces = new Map();

function createMemoryStore(namespace) {
  if (!memoryNamespaces.has(namespace)) memoryNamespaces.set(namespace, new Map());
  const data = memoryNamespaces.get(namespace);
  return {
    async get(id) {
      return data.get(id) ?? null;
    },
    async set(id, value) {
      data.set(id, value);
      return value;
    },
    async delete(id) {
      return data.delete(id);
    },
    async list() {
      return Array.from(data.values());
    }
  };
}

function createRedisStore(namespace, client) {
  const entryKey = (id) => `${namespace}:entry:${id}`;
  const indexKey = `${namespace}:ids`;

  return {
    async get(id) {
      const raw = await client.get(entryKey(id));
      return raw ? JSON.parse(raw) : null;
    },
    async set(id, value) {
      await client.set(entryKey(id), JSON.stringify(value));
      await client.sAdd(indexKey, id);
      return value;
    },
    async delete(id) {
      await client.del(entryKey(id));
      await client.sRem(indexKey, id);
    },
    async list() {
      const ids = await client.sMembers(indexKey);
      if (ids.length === 0) return [];
      const values = await Promise.all(ids.map((id) => client.get(entryKey(id))));
      return values.filter(Boolean).map((raw) => JSON.parse(raw));
    }
  };
}

let clientPromise = null;

function getRedisClient() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!clientPromise) {
    const { createClient } = require('redis');
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(retries * 50, 2000) }
    });
    client.on('error', (error) => console.error(`redis connection error: ${error.message}`));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

async function createStore(namespace) {
  const client = await getRedisClient();
  return client ? createRedisStore(namespace, client) : createMemoryStore(namespace);
}

module.exports = { createStore };
