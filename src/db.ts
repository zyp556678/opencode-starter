import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Session } from "./types.js";

// Silence ExperimentalWarning for node:sqlite
const origEmit = (process as any).emit.bind(process);
(process as any).emit = function (name: string, data: any, ...rest: any[]) {
  if (name === "warning" && data && (data.name === "ExperimentalWarning" || data.message?.includes("SQLite"))) {
    return false;
  }
  return origEmit(name, data, ...rest);
};

function getDbPath(): string {
  if (process.env.OPENCODE_DB_PATH) {
    return process.env.OPENCODE_DB_PATH;
  }
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

/**
 * Direct read from OpenCode SQLite database (ultra-fast, ~5ms)
 */
function fetchSessionsFromSqlite(dbFilePath: string): Session[] | null {
  try {
    if (!fs.existsSync(dbFilePath)) {
      return null;
    }

    // Dynamic require for node:sqlite to avoid esbuild stripping node: prefix
    const sqliteModule = "node:sqlite";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require(sqliteModule);
    const db = new DatabaseSync(dbFilePath, { open: true, readOnly: true });

    try {
      const stmt = db.prepare(`
        SELECT id, title, directory, time_created, time_updated
        FROM session
        WHERE time_archived IS NULL
        ORDER BY time_updated DESC
      `);
      const rows = stmt.all() as Array<{
        id: string;
        title: string;
        directory: string;
        time_created: number | bigint;
        time_updated: number | bigint;
      }>;

      return rows.map((r) => ({
        id: String(r.id),
        title: String(r.title || "无标题会话"),
        directory: path.normalize(String(r.directory)),
        created: Number(r.time_created),
        updated: Number(r.time_updated),
      }));
    } finally {
      try {
        db.close();
      } catch {
        // ignore close error
      }
    }
  } catch {
    return null;
  }
}

/**
 * Fallback to official opencode CLI
 */
function fetchSessionsFromCli(): Session[] {
  try {
    let stdout: string;
    if (process.platform === "win32") {
      const comspec = process.env.COMSPEC || "cmd.exe";
      stdout = execFileSync(comspec, ["/c", "opencode", "session", "list", "--format", "json"], {
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } else {
      stdout = execFileSync("opencode", ["session", "list", "--format", "json"], {
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    }

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item: any) => ({
      id: String(item.id),
      title: String(item.title || "无标题会话"),
      directory: path.normalize(String(item.directory)),
      created: Number(item.created) || Date.now(),
      updated: Number(item.updated) || Date.now(),
    }));
  } catch {
    return [];
  }
}

/**
 * Get all OpenCode sessions with fallback
 */
export function getAllSessions(): Session[] {
  const dbPath = getDbPath();
  const sqliteSessions = fetchSessionsFromSqlite(dbPath);
  if (sqliteSessions !== null) {
    return sqliteSessions;
  }
  return fetchSessionsFromCli();
}

/**
 * Delete a session permanently (same as Ctrl+D in OpenCode)
 */
export function deleteSession(sessionId: string): { success: boolean; error?: string } {
  // 1. Try official OpenCode CLI first
  try {
    if (process.platform === "win32") {
      const comspec = process.env.COMSPEC || "cmd.exe";
      execFileSync(comspec, ["/c", "opencode", "session", "delete", sessionId], {
        encoding: "utf8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      execFileSync("opencode", ["session", "delete", sessionId], {
        encoding: "utf8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    return { success: true };
  } catch (cliErr: any) {
    // 2. Fallback to SQLite direct archive if CLI is unavailable
    try {
      const dbPath = getDbPath();
      if (fs.existsSync(dbPath)) {
        const sqliteModule = "node:sqlite";
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { DatabaseSync } = require(sqliteModule);
        const db = new DatabaseSync(dbPath, { open: true });
        try {
          const stmt = db.prepare("UPDATE session SET time_archived = ? WHERE id = ?");
          stmt.run(Date.now(), sessionId);
          return { success: true };
        } finally {
          try {
            db.close();
          } catch {}
        }
      }
    } catch (sqlErr: any) {
      return { success: false, error: cliErr?.message || sqlErr?.message || "删除会话失败" };
    }
    return { success: false, error: cliErr?.message || "删除会话失败" };
  }
}
