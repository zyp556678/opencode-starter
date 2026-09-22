import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LauncherConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode-launcher");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: LauncherConfig = {
  pinnedPaths: [],
  customPaths: [],
  hiddenPaths: [],
  folderHistory: [],
  autoReturnToLauncher: false,
};

function ensureDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function loadConfig(): LauncherConfig {
  try {
    ensureDirSync(CONFIG_DIR);
    if (!fs.existsSync(CONFIG_FILE)) {
      saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      pinnedPaths: Array.isArray(parsed.pinnedPaths) ? parsed.pinnedPaths : [],
      customPaths: Array.isArray(parsed.customPaths) ? parsed.customPaths : [],
      hiddenPaths: Array.isArray(parsed.hiddenPaths) ? parsed.hiddenPaths : [],
      folderHistory: Array.isArray(parsed.folderHistory) ? parsed.folderHistory : [],
      lastOpenedPath: typeof parsed.lastOpenedPath === "string" ? parsed.lastOpenedPath : undefined,
      autoReturnToLauncher: Boolean(parsed.autoReturnToLauncher),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: LauncherConfig): void {
  try {
    ensureDirSync(CONFIG_DIR);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("保存配置文件失败:", err);
  }
}

export function recordFolderAccess(folderPath: string): void {
  const config = loadConfig();
  const normalized = path.normalize(folderPath);

  config.lastOpenedPath = normalized;

  // Add to customPaths if not present
  if (!config.customPaths.includes(normalized)) {
    config.customPaths.push(normalized);
  }

  // Remove from hidden if it was hidden
  config.hiddenPaths = config.hiddenPaths.filter((p) => path.normalize(p) !== normalized);

  // Update history
  const existingIdx = config.folderHistory.findIndex((item) => path.normalize(item.path) === normalized);
  if (existingIdx >= 0) {
    config.folderHistory[existingIdx].lastOpened = Date.now();
  } else {
    config.folderHistory.push({ path: normalized, lastOpened: Date.now() });
  }

  // Keep latest 50 history entries
  config.folderHistory.sort((a, b) => b.lastOpened - a.lastOpened);
  if (config.folderHistory.length > 50) {
    config.folderHistory = config.folderHistory.slice(0, 50);
  }

  saveConfig(config);
}

export function togglePinProject(folderPath: string): boolean {
  const config = loadConfig();
  const normalized = path.normalize(folderPath);
  const isPinned = config.pinnedPaths.some((p) => path.normalize(p) === normalized);

  if (isPinned) {
    config.pinnedPaths = config.pinnedPaths.filter((p) => path.normalize(p) !== normalized);
  } else {
    config.pinnedPaths.push(normalized);
  }

  saveConfig(config);
  return !isPinned;
}

export function hideProject(folderPath: string): void {
  const config = loadConfig();
  const normalized = path.normalize(folderPath);

  if (!config.hiddenPaths.some((p) => path.normalize(p) === normalized)) {
    config.hiddenPaths.push(normalized);
  }

  // Also remove from pinned
  config.pinnedPaths = config.pinnedPaths.filter((p) => path.normalize(p) !== normalized);
  // Remove from custom
  config.customPaths = config.customPaths.filter((p) => path.normalize(p) !== normalized);

  saveConfig(config);
}
