// Silence ExperimentalWarning and DeprecationWarning across Node.js
const origEmit = (process as any).emit.bind(process);
(process as any).emit = function (name: string, data: any, ...rest: any[]) {
  if (
    name === "warning" &&
    data &&
    (data.name === "ExperimentalWarning" ||
      data.name === "DeprecationWarning" ||
      data.message?.includes("DEP0190") ||
      data.message?.includes("SQLite"))
  ) {
    return false;
  }
  return origEmit(name, data, ...rest);
};

import path from "node:path";
import pc from "picocolors";
import { startLauncher } from "./ui.js";
import { resolveFolderPath, isValidDirectory } from "./utils.js";
import { recordFolderAccess } from "./config.js";
import { getAllProjects } from "./projectService.js";
import { launchOpenCode } from "./runner.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle flags
  if (args.includes("-h") || args.includes("--help")) {
    console.log(`
${pc.bold(pc.cyan("OpenCode Launcher (ocl)"))} - 终端交互式项目启动器

${pc.bold("用法:")}
  ocl                 打开交互式项目选择与会话管理菜单
  ocl <目录路径>      直接打开指定目录并进入操作菜单
  ocl --help, -h      显示帮助信息
  ocl --version, -v   显示版本号

${pc.bold("特性:")}
  • 自动记忆历史项目路径与自定义置顶
  • 自动同步 OpenCode 本地历史会话对话
  • 一键新建会话、继续最新会话、浏览选择历史会话
  • 支持 Windows 原生文件夹选择弹窗与手动输入
`);
    process.exit(0);
  }

  if (args.includes("-v") || args.includes("--version")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../package.json");
    console.log(`opencode-launcher v${pkg.version}`);
    process.exit(0);
  }

  // If a directory argument was provided directly
  const firstArg = args.find((arg) => !arg.startsWith("-"));
  if (firstArg) {
    const targetPath = resolveFolderPath(firstArg);
    if (isValidDirectory(targetPath)) {
      recordFolderAccess(targetPath);
    }
  }

  try {
    await startLauncher();
    process.exit(0);
  } catch (err: any) {
    if (err?.name === "ExitPromptError" || err?.message?.includes("force closed")) {
      console.log(pc.gray("\n已退出。"));
      process.exit(0);
    }
    console.error(pc.red(`运行时异常: ${err.message}`));
    process.exit(1);
  }
}

main();
