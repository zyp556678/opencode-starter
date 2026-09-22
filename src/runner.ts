import { spawn } from "node:child_process";
import path from "node:path";
import pc from "picocolors";
import { recordFolderAccess } from "./config.js";

export interface LaunchOptions {
  directory: string;
  mode: "new" | "continue" | "session";
  sessionId?: string;
}

/**
 * Launch OpenCode in a new independent terminal window
 */
export async function launchOpenCode(options: LaunchOptions): Promise<boolean> {
  const { directory, mode, sessionId } = options;

  // Record history
  recordFolderAccess(directory);

  const displayName = path.basename(directory) || directory;
  const windowTitle = `OpenCode - ${displayName}`;

  // Build command arguments
  const opencodeArgs = [`"${directory}"`];
  if (mode === "continue") {
    opencodeArgs.push("-c");
  } else if (mode === "session" && sessionId) {
    opencodeArgs.push("-s", `"${sessionId}"`);
  }

  const opencodeCmdString = `opencode ${opencodeArgs.join(" ")}`;

  console.log();
  console.log(pc.green(`🚀 正在开启新独立窗口运行 OpenCode...`));
  console.log(pc.gray(`📁 工作目录: ${directory}`));
  if (sessionId) {
    console.log(pc.gray(`💬 会话 ID: ${sessionId}`));
  } else if (mode === "continue") {
    console.log(pc.gray(`⚡ 模式: 继续最新会话 (-c)`));
  } else {
    console.log(pc.gray(`✨ 模式: 新建会话`));
  }

  if (process.platform === "win32") {
    // 1. Try Windows Terminal first for modern tabbed independent window
    try {
      let wtFailed = false;
      const wtChild = spawn(
        "wt.exe",
        [
          "--window",
          "new",
          "--title",
          windowTitle,
          "-d",
          directory,
          "cmd.exe",
          "/c",
          opencodeCmdString,
        ],
        {
          detached: true,
          stdio: "ignore",
        }
      );

      wtChild.on("error", () => {
        wtFailed = true;
      });

      // Brief delay to detect early spawn failure
      await new Promise((r) => setTimeout(r, 120));

      if (!wtFailed) {
        wtChild.unref();
        return true;
      }
    } catch {
      // Fall through to standard Windows start
    }

    // 2. Standard Windows cmd.exe /c start fallback
    try {
      const comspec = process.env.COMSPEC || "cmd.exe";
      const cmdChild = spawn(
        comspec,
        ["/c", "start", windowTitle, "/d", directory, "cmd.exe", "/c", opencodeCmdString],
        {
          detached: true,
          stdio: "ignore",
        }
      );
      cmdChild.unref();
      return true;
    } catch (err: any) {
      console.error(pc.red(`❌ 启动新窗口失败: ${err.message}`));
      return false;
    }
  } else if (process.platform === "darwin") {
    // macOS Terminal
    const script = `tell application "Terminal" to do script "cd '${directory}' && ${opencodeCmdString}"`;
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
    return true;
  } else {
    // Linux terminal
    spawn("x-terminal-emulator", ["-e", `sh -c "cd '${directory}' && ${opencodeCmdString}"`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  }
}
