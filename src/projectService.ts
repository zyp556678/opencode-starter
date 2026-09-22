import path from "node:path";
import { getAllSessions } from "./db.js";
import { loadConfig } from "./config.js";
import { isValidDirectory } from "./utils.js";
import { ProjectItem, Session } from "./types.js";

function normalizeDir(d: string): string {
  return path.normalize(d);
}

function dirEquals(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

export function getAllProjects(): ProjectItem[] {
  const config = loadConfig();
  const allSessions = getAllSessions();

  // Group sessions by normalized directory
  const sessionMap = new Map<string, Session[]>();
  for (const session of allSessions) {
    const norm = normalizeDir(session.directory);
    // Find existing key if case-insensitively equal
    let foundKey = "";
    for (const key of sessionMap.keys()) {
      if (dirEquals(key, norm)) {
        foundKey = key;
        break;
      }
    }
    const targetKey = foundKey || norm;
    const list = sessionMap.get(targetKey) || [];
    list.push(session);
    sessionMap.set(targetKey, list);
  }

  // Collect all known directories
  const directoriesSet = new Set<string>();

  for (const dir of sessionMap.keys()) {
    directoriesSet.add(dir);
  }
  for (const dir of config.pinnedPaths) {
    directoriesSet.add(normalizeDir(dir));
  }
  for (const dir of config.customPaths) {
    directoriesSet.add(normalizeDir(dir));
  }
  for (const item of config.folderHistory) {
    directoriesSet.add(normalizeDir(item.path));
  }

  // Filter hidden paths
  const hiddenNormalized = config.hiddenPaths.map(normalizeDir);
  const activeDirectories = Array.from(directoriesSet).filter(
    (d) => !hiddenNormalized.some((h) => dirEquals(h, d))
  );

  // Build ProjectItems
  const projects: ProjectItem[] = [];

  for (const dir of activeDirectories) {
    // Find matching sessions
    let sessions: Session[] = [];
    for (const [key, sList] of sessionMap.entries()) {
      if (dirEquals(key, dir)) {
        sessions = sList;
        break;
      }
    }
    sessions.sort((a, b) => b.updated - a.updated);

    const isPinned = config.pinnedPaths.some((p) => dirEquals(p, dir));
    const historyItem = config.folderHistory.find((h) => dirEquals(h.path, dir));

    const latestSessionTime = sessions.length > 0 ? sessions[0].updated : 0;
    const historyTime = historyItem ? historyItem.lastOpened : 0;
    const lastActive = Math.max(latestSessionTime, historyTime);

    const displayName = path.basename(dir) || dir;
    const exists = isValidDirectory(dir);

    projects.push({
      directory: dir,
      displayName,
      exists,
      pinned: isPinned,
      lastActive,
      sessions,
    });
  }

  // Sort: pinned first, then by lastActive DESC
  projects.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.lastActive - a.lastActive;
  });

  return projects;
}
