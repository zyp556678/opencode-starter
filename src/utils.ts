import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Format timestamp to friendly relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "未知时间";

  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "刚刚";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days === 1) {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `昨天 ${h}:${m}`;
  }
  if (days < 7) return `${days}天前`;

  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const currentYear = new Date().getFullYear();

  if (year === currentYear) {
    return `${month}-${day}`;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Expand ~ to user home directory and normalize path
 */
export function resolveFolderPath(inputPath: string): string {
  let resolved = inputPath.trim();
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  return path.resolve(resolved);
}

/**
 * Check if path exists and is a directory
 */
export function isValidDirectory(folderPath: string): boolean {
  try {
    if (!fs.existsSync(folderPath)) return false;
    return fs.statSync(folderPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Shorten path for elegant display in terminal
 */
export function truncatePath(fullPath: string, maxLength = 45): string {
  if (fullPath.length <= maxLength) return fullPath;
  const parts = fullPath.split(/[\\/]/);
  if (parts.length <= 2) return fullPath;

  const first = parts[0] + path.sep + parts[1];
  const last = parts[parts.length - 1];
  const middle = "...";
  const candidate = `${first}${path.sep}${middle}${path.sep}${last}`;
  if (candidate.length <= maxLength) return candidate;
  return `...${fullPath.slice(fullPath.length - maxLength + 3)}`;
}

/**
 * Open native Windows Folder Browser Dialog
 */
export function openWindowsFolderPicker(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '请选择 OpenCode 项目文件夹'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`.trim();

    const base64 = Buffer.from(psScript, "utf16le").toString("base64");
    const result = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", base64], {
      encoding: "utf8",
      timeout: 60000,
    }).trim();

    return result && isValidDirectory(result) ? path.normalize(result) : null;
  } catch {
    return null;
  }
}
