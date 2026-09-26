import { open } from "sqlite";
import { Adapter } from "./Adapter.js";
import sqlite3 from "sqlite3";
import fs from "node:fs/promises";
import path from "node:path";

class SQLiteAdapter extends Adapter {
  database = null;
  databasePath;

  constructor(props) {
    super();
    this.databasePath = props?.databasePath || "./wa_credentials/database.db";
  }

  async init() {
    if (!this.database) {
      await fs.mkdir(path.dirname(path.resolve(this.databasePath)), {
        recursive: true,
      });

      this.database = await open({
        filename: `${path.resolve(this.databasePath)}`,
        driver: sqlite3.Database,
      });

      await this.database.exec("PRAGMA journal_mode = WAL;");
      await this.database.exec("PRAGMA busy_timeout = 5000;");
      this.database.configure("busyTimeout", 5000);

      await this.database.exec(`
            CREATE TABLE IF NOT EXISTS auth_store (
            id TEXT,
            session_id TEXT,
            category TEXT,
            value TEXT,
            PRIMARY KEY (id, session_id)
            )
        `);
    }
  }

  async readData(sessionId, key) {
    await this.init();

    const row = await this.database.get(
      `SELECT value FROM auth_store WHERE id = ? AND session_id = ?`,
      key,
      sessionId
    );
    return row ? row.value : null;
  }

  async writeData(sessionId, key, category, data) {
    await this.init();
    await this.database.run(
      `
      INSERT OR REPLACE INTO auth_store (id, session_id, category, value)
      VALUES (?, ?, ?, ?)
      `,
      key,
      sessionId,
      category,
      data
    );
  }

  async deleteData(sessionId, key) {
    await this.init();
    await this.database.run(
      `DELETE FROM auth_store WHERE id = ? AND session_id = ?`,
      key,
      sessionId
    );
  }

  async clearData(sessionId) {
    await this.init();
    await this.database.run(
      `DELETE FROM auth_store WHERE session_id = ?`,
      sessionId
    );
  }

  async listSessions() {
    await this.init();
    const sessions = await this.database.all(
      "SELECT DISTINCT session_id FROM auth_store"
    );
    return sessions.map((row) => row.session_id);
  }
}

export { SQLiteAdapter };