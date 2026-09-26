import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "node:path";
import {
  BufferJSON,
  initAuthCreds,
  proto,
} from "baileys";
import { CREDENTIALS } from "../Defaults/index.js";
import fs from "node:fs/promises";

let db = null;

const getDb = async () => {
  if (!db) {
    await fs.mkdir(path.resolve(CREDENTIALS.DIR_NAME), { recursive: true });

    db = await open({
      filename: `${path.resolve(CREDENTIALS.DIR_NAME)}/${
        CREDENTIALS.DATABASE_NAME
      }`,
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA busy_timeout = 5000;");
    db.configure("busyTimeout", 5000);

    await db.exec(`
    CREATE TABLE IF NOT EXISTS auth_store (
      id TEXT,
      session_id TEXT,
      category TEXT,
      value TEXT,
      PRIMARY KEY (id, session_id)
    )
  `);
  }

  return db;
};

const useSQLiteAuthState = async (sessionId) => {
  const database = await getDb();

  const writeData = async (id, category, data) => {
    await database.run(
      `
      INSERT OR REPLACE INTO auth_store (id, session_id, category, value)
      VALUES (?, ?, ?, ?)
      `,
      id,
      sessionId,
      category,
      JSON.stringify(data, BufferJSON.replacer)
    );
  };

  const readData = async (id) => {
    const row = await database.get(
      `SELECT value FROM auth_store WHERE id = ? AND session_id = ?`,
      id,
      sessionId
    );
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };

  const removeData = async (id) => {
    await database.run(
      `DELETE FROM auth_store WHERE id = ? AND session_id = ?`,
      id,
      sessionId
    );
  };
  const clearData = async () => {
    await database.run(
      `DELETE FROM auth_store WHERE session_id = ?`,
      sessionId
    );
  };

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              if (value) {
                await writeData(`${category}-${id}`, category, value);
              } else {
                await removeData(`${category}-${id}`);
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData("creds", "credentials", creds);
    },
    deleteCreds: async () => {
      await clearData();
    },
  };
};

const getSQLiteSessionIds = async () => {
  const database = await getDb();
  const sessions = await database.all(
    "SELECT DISTINCT session_id FROM auth_store"
  );
  return sessions.map((row) => row.session_id);
};

class SQLiteStore {
  sessionId;
  state;

  writeData = async (id, category, data) => {
    const db = await getDb();

    await db.run(
      `
      INSERT OR REPLACE INTO auth_store (id, session_id, category, value)
      VALUES (?, ?, ?, ?)
      `,
      id,
      this.sessionId,
      category,
      JSON.stringify(data, BufferJSON.replacer)
    );
  };

  readData = async (id) => {
    const db = await getDb();

    const row = await db.get(
      `SELECT value FROM auth_store WHERE id = ? AND session_id = ?`,
      id,
      this.sessionId
    );
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };

  removeData = async (id) => {
    const db = await getDb();

    await db.run(
      `DELETE FROM auth_store WHERE id = ? AND session_id = ?`,
      id,
      this.sessionId
    );
  };
  clearData = async () => {
    const db = await getDb();

    await db.run(`DELETE FROM auth_store WHERE session_id = ?`, this.sessionId);
  };

  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = {
      creds: initAuthCreds(),
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await this.readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              if (value) {
                await this.writeData(`${category}-${id}`, category, value);
              } else {
                await this.removeData(`${category}-${id}`);
              }
            }
          }
        },
      },
    };
  }

  async saveCreds() {
    await this.writeData("creds", "credentials", this.state.creds);
  }
  async deleteCreds() {
    await this.clearData();
  }
}

export { useSQLiteAuthState, getSQLiteSessionIds, SQLiteStore };