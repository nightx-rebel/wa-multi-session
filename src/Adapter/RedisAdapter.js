import { Adapter } from "./Adapter.js";
import { createClient } from "redis";

class RedisAdapter extends Adapter {
  client;
  keyPrefix;

  constructor(props) {
    super();
    this.client = createClient({ url: props.url });
    this.keyPrefix = props.keyPrefix || "wa_multi_session:";
  }

  async init() {
    if (!this.client.isOpen) {
      await this.client.connect();
      await this.client.ping();
    }
  }

  async readData(sessionId, key) {
    await this.init();
    const value = await this.client.get(`${this.keyPrefix}${sessionId}:${key}`);
    if (!value) return null;
    if (typeof value === "string") return value;
    return null;
  }

  async writeData(sessionId, key, category, data) {
    await this.init();
    const redisKey = `${this.keyPrefix}${sessionId}:${key}`;
    await this.client.set(redisKey, data);
  }

  async deleteData(sessionId, key) {
    await this.init();
    const redisKey = `${this.keyPrefix}${sessionId}:${key}`;
    await this.client.del(redisKey);
  }

  async clearData(sessionId) {
    await this.init();
    const pattern = `${this.keyPrefix}${sessionId}:*`;
    const keys = await this.client.keys(pattern);

    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  async listSessions() {
    await this.init();
    const pattern = `${this.keyPrefix}*:*`;
    const keys = await this.client.keys(pattern);

    const sessions = new Set();

    for (const key of keys) {
      const keyWithoutPrefix = key.substring(this.keyPrefix.length);
      const sessionId = keyWithoutPrefix.split(":")[0];
      if (sessionId) {
        sessions.add(sessionId);
      }
    }

    return Array.from(sessions);
  }
}

export { RedisAdapter };