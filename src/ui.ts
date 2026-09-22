import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { input, confirm } from "@inquirer/prompts";
import pc from "picocolors";
import { mouseSelect, Separator, disableMouseTracking } from "./mouseSelect.js";
import { getAllProjects } from "./projectService.js";
import { ProjectItem, Session } from "./types.js";
import {
  formatRelativeTime,
  isValidDirectory,
  truncatePath,
  openWindowsFolderPicker,
} from "./utils.js";
import {
  togglePinProject,
  hideProject,
  recordFolderAccess,
  loadConfig,
  saveConfig,
} from "./config.js";
import { deleteSession } from "./db.js";
import { launchOpenCode } from "./runner.js";
import stringWidth from "string-width";

function padColumn(str: string, targetWidth: number): string {
  const w = stringWidth(str);
  if (w >= targetWidth) return str;
  return str + " ".repeat(targetWidth - w);
}

/**
 * Handle Ctrl+C or prompt abort gracefully
 */
export async function safePrompt<T>(promptFn: () => Promise<T>): Promise<T | null> {
  try {
    return await promptFn();
  } catch (err: any) {
    if (err?.name === "ExitPromptError" || err?.message?.includes("force closed")) {
      return null;
    }
    throw err;
  }
}

/**
 * Main application loop
 */
export async function startLauncher(): Promise<void> {
  try {
    while (true) {
      const action = await showMainMenu();
      if (!action || action === "exit") {
        console.log(pc.gray("\n👋 再见！"));
        disableMouseTracking();
        process.exit(0);
      }
    }
  } finally {
    disableMouseTracking();
    process.exit(0);
  }
}

/**
 * Main Menu
 */
async function showMainMenu(): Promise<"continue" | "exit" | void> {
  const projects = getAllProjects();

  const bannerLines = [
    pc.cyan("┌─────────────────────────────────────────────────────────────┐"),
    pc.cyan("│") +
      pc.bold(pc.white("                 ⚡ OpenCode 终端启动器                      ")) +
      pc.cyan("│"),
    pc.cyan("│") +
      pc.gray("              项目快速选择 · 会话记忆与管理                  ") +
      pc.cyan("│"),
    pc.cyan("└─────────────────────────────────────────────────────────────┘"),
  ];

  const headerLines = [
    `${pc.cyan("📁 历史项目面板")}  ${pc.gray(`(共 ${projects.length} 个已记忆项目)`)}`,
  ];

  type MainChoiceValue =
    | { type: "project"; project: ProjectItem }
    | { type: "action"; action: "open_picker" | "search" | "view_all" | "exit" };

  const choices: Array<{
    name: string;
    value: MainChoiceValue;
    description?: string;
  } | Separator> = [];

  if (projects.length > 0) {
    for (const p of projects) {
      const pinPrefix = p.pinned ? pc.yellow("📌 ") : "📂 ";
      const statusSuffix = !p.exists ? pc.red(" [已失效]") : "";
      const sessionCount = p.sessions.length;
      const sessionInfo =
        sessionCount > 0
          ? pc.cyan(`[${sessionCount}会话 · ${formatRelativeTime(p.lastActive)}]`)
          : pc.gray("[无会话]");

      const colName = padColumn(`${pinPrefix}${pc.bold(p.displayName)}`, 18);
      const colPath = padColumn(pc.gray(truncatePath(p.directory, 28)), 30);
      const colBadge = `${sessionInfo}${statusSuffix}`;

      const latestTitle =
        p.sessions.length > 0 ? `最新: ${p.sessions[0].title}` : "无历史会话";

      choices.push({
        name: `${colName} ${colPath} ${colBadge}`,
        value: { type: "project", project: p },
        description: `完整路径: ${p.directory} | ${latestTitle}`,
      });
    }
  } else {
    choices.push(new Separator(pc.yellow("⚠️ 暂未检测到历史项目，请使用下方选项浏览选择项目文件夹")));
  }

  // Fixed Bottom Actions (Always visible, never scrolled out!)
  const fixedChoices: Array<{
    name: string;
    value: MainChoiceValue;
    description?: string;
  } | Separator> = [];

  if (process.platform === "win32") {
    fixedChoices.push({
      name: pc.blue("🪟  Windows 弹窗浏览选择文件夹..."),
      value: { type: "action", action: "open_picker" },
      description: "打开原生 Windows 文件夹选择器添加新项目",
    });
  }

  if (projects.length > 0) {
    fixedChoices.push({
      name: pc.cyan("📋  查看全部历史位置清单 (完整绝对路径列表)"),
      value: { type: "action", action: "view_all" },
      description: "查看所有已记忆项目文件夹的详细绝对路径与状态",
    });
  }

  if (projects.length > 3) {
    fixedChoices.push({
      name: pc.magenta("🔍  快速搜索项目"),
      value: { type: "action", action: "search" },
      description: "按名称或目录过滤项目",
    });
  }

  fixedChoices.push({
    name: pc.gray("❌  退出启动器"),
    value: { type: "action", action: "exit" },
  });

  const selected = await safePrompt(() =>
    mouseSelect<MainChoiceValue>({
      bannerLines,
      headerLines,
      message: "请选择项目或操作:",
      choices,
      fixedChoices,
    })
  );

  if (!selected) {
    return "exit";
  }

  if (selected.type === "action") {
    switch (selected.action) {
      case "exit":
        return "exit";
      case "open_picker":
        await handleWindowsPicker();
        return "continue";
      case "view_all":
        await handleViewAllLocations(projects);
        return "continue";
      case "search":
        await handleSearchProjects(projects);
        return "continue";
      default:
        return "continue";
    }
  }

  if (selected.type === "project") {
    await handleProjectSelected(selected.project);
    return "continue";
  }
}

/**
 * Handle selecting an existing project
 */
async function handleProjectSelected(project: ProjectItem): Promise<void> {
  while (true) {
    if (!project.exists) {
      console.clear();
      console.log(pc.cyan(`\n📁 项目: `) + pc.bold(project.displayName));
      console.log(pc.gray(`   路径: ${project.directory}`));
      console.log(pc.yellow("⚠️ 该目录在磁盘上已不存在，无法直接启动。"));
      const removeAns = await safePrompt(() =>
        confirm({
          message: "是否将该项目从记录中移除？",
          default: true,
        })
      );
      if (removeAns) {
        hideProject(project.directory);
        console.log(pc.green("✅ 已从记录中移除"));
      }
      return;
    }

    const headerLines = [
      `${pc.cyan("📁 当前项目:")} ${pc.bold(pc.white(project.displayName))}`,
      `${pc.gray("📍 物理路径:")} ${pc.white(truncatePath(project.directory, 56))}`,
      `${pc.gray("📊 项目状态:")} ${project.exists ? pc.green("● 路径有效") : pc.red("○ 路径已失效")}   ${pc.gray("│   历史会话:")} ${pc.cyan(project.sessions.length + " 个")}`,
    ];

    type ActionType =
      | "new"
      | "continue"
      | "sessions"
      | "delete_session"
      | "pin"
      | "explorer"
      | "remove"
      | "back";

    const choices: Array<{
      name: string;
      value: ActionType;
      description?: string;
    } | Separator> = [];

    // If there is any session
    if (project.sessions.length > 0) {
      const latest = project.sessions[0];
      choices.push({
        name: pc.green(`⚡ 继续最新会话`) + pc.gray(`: "${truncatePath(latest.title, 35)}"`),
        value: "continue",
        description: `会话 ID: ${latest.id} (${formatRelativeTime(latest.updated)})`,
      });
    }

    choices.push({
      name: pc.cyan("✨ 开启全新会话"),
      value: "new",
      description: "在该目录下启动一个全新的空白会话",
    });

    if (project.sessions.length > 0) {
      choices.push({
        name: pc.yellow(`📜 浏览全部历史会话 (${project.sessions.length}个)`),
        value: "sessions",
        description: "选择指定的历史对话进行恢复",
      });

      choices.push({
        name: pc.red("🗑️ 删除历史会话 (Ctrl+D)"),
        value: "delete_session",
        description: "选择并永久删除该项目下的指定历史会话",
      });
    }

    choices.push(new Separator());

    choices.push({
      name: project.pinned ? pc.gray("📌 取消置顶此项目") : pc.yellow("📌 置顶此项目"),
      value: "pin",
    });

    if (process.platform === "win32") {
      choices.push({
        name: pc.blue("📂 在资源管理器中打开此文件夹"),
        value: "explorer",
      });
    }

    choices.push({
      name: pc.red("🗑️ 从历史记录中移除"),
      value: "remove",
    });

    choices.push({
      name: pc.gray("🔙 返回项目列表"),
      value: "back",
    });

    const action = await safePrompt(() =>
      mouseSelect<ActionType>({
        headerLines,
        message: "请选择操作:",
        choices,
      })
    );

    if (!action || action === "back") {
      return;
    }

    if (action === "continue") {
      await launchOpenCode({
        directory: project.directory,
        mode: "continue",
      });
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (action === "new") {
      await launchOpenCode({
        directory: project.directory,
        mode: "new",
      });
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (action === "sessions") {
      const sessionChosen = await handleSelectSession(project);
      if (sessionChosen) {
        await launchOpenCode({
          directory: project.directory,
          mode: "session",
          sessionId: sessionChosen.id,
        });
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
    }

    if (action === "delete_session") {
      await handleDeleteSessionFlow(project);
    }

    if (action === "pin") {
      const nowPinned = togglePinProject(project.directory);
      project.pinned = nowPinned;
      console.log(pc.green(nowPinned ? "✅ 已置顶该项目" : "✅ 已取消置顶"));
    }

    if (action === "explorer") {
      exec(`explorer "${project.directory}"`);
    }

    if (action === "remove") {
      hideProject(project.directory);
      console.log(pc.green("✅ 已从记录中移除"));
      return;
    }
  }
}

/**
 * Session selector menu
 */
async function handleSelectSession(project: ProjectItem): Promise<Session | null> {
  while (project.sessions.length > 0) {
    const headerLines = [
      `${pc.cyan("📜 历史会话清单")} ── ${pc.bold(pc.white(project.displayName))}`,
      `${pc.gray("📊 对话总计:")} ${pc.cyan(project.sessions.length + " 个历史对话")}   ${pc.gray("│   目录:")} ${pc.gray(truncatePath(project.directory, 45))}`,
    ];

    type SessionChoiceValue =
      | { type: "resume"; session: Session }
      | { type: "delete_mode" }
      | { type: "back" };

    const choices: Array<{
      name: string;
      value: SessionChoiceValue;
      description?: string;
    } | Separator> = [];

    for (const s of project.sessions) {
      const timeStr = formatRelativeTime(s.updated);
      const colTime = padColumn(pc.cyan(`[${timeStr}]`), 14);
      const colTitle = truncatePath(s.title, 50);
      choices.push({
        name: `💬 ${colTime} ${colTitle}`,
        value: { type: "resume", session: s },
        description: `会话 ID: ${s.id} | 更新时间: ${new Date(s.updated).toLocaleString()}`,
      });
    }

    const fixedChoices: Array<{
      name: string;
      value: SessionChoiceValue;
      description?: string;
    } | Separator> = [
      {
        name: pc.red("🗑️  删除指定历史会话 (Ctrl+D)"),
        value: { type: "delete_mode" },
        description: "进入会话删除模式，选择并彻底销毁指定会话",
      },
      {
        name: pc.gray("🔙 返回上一级"),
        value: { type: "back" },
      },
    ];

    const chosen = await safePrompt(() =>
      mouseSelect<SessionChoiceValue>({
        headerLines,
        message: "请选择要恢复的会话，或选择删除模式:",
        choices,
        fixedChoices,
      })
    );

    if (!chosen || chosen.type === "back") {
      return null;
    }

    if (chosen.type === "resume") {
      return chosen.session;
    }

    if (chosen.type === "delete_mode") {
      await handleDeleteSessionFlow(project);
    }
  }

  return null;
}

/**
 * Handle deleting sessions with confirmation (same as Ctrl+D in OpenCode)
 */
async function handleDeleteSessionFlow(project: ProjectItem): Promise<void> {
  while (project.sessions.length > 0) {
    const headerLines = [
      `${pc.red("🗑️  永久删除会话模式 (Ctrl+D)")} ── ${pc.bold(pc.white(project.displayName))}`,
      pc.yellow("⚠️  警告：在此处选中的会话将被永久抹除，请谨慎选择！"),
    ];

    const choices: Array<{
      name: string;
      value: Session | null;
      description?: string;
    } | Separator> = [];

    for (const s of project.sessions) {
      const timeStr = formatRelativeTime(s.updated);
      const colTime = padColumn(pc.gray(`(${timeStr})`), 14);
      const colTitle = truncatePath(s.title, 48);
      choices.push({
        name: `${pc.red("🗑️ ")} ${pc.white(colTitle)} ${colTime}`,
        value: s,
        description: `会话 ID: ${s.id} | 更新时间: ${new Date(s.updated).toLocaleString()}`,
      });
    }

    const fixedChoices: Array<{
      name: string;
      value: Session | null;
      description?: string;
    } | Separator> = [
      {
        name: pc.gray("🔙 退出删除模式，返回上一级"),
        value: null,
      },
    ];

    const target = await safePrompt(() =>
      mouseSelect<Session | null>({
        headerLines,
        message: "请选择要删除的会话:",
        choices,
        fixedChoices,
      })
    );

    if (!target) {
      return;
    }

    console.log();
    console.log(pc.yellow("⚠️  警告：此操作与 OpenCode 原生 Ctrl+D 相同，将永久删除该会话！"));
    console.log(pc.white(`   会话标题: ${pc.bold(target.title)}`));
    console.log(pc.gray(`   会话编号: ${target.id}`));
    console.log(pc.gray(`   最后活跃: ${new Date(target.updated).toLocaleString()}`));
    console.log();

    const confirmed = await safePrompt(() =>
      confirm({
        message: pc.red("是否确认彻底删除此会话？"),
        default: false,
      })
    );

    if (confirmed) {
      console.log(pc.cyan("\n⏳ 正在删除会话..."));
      const result = deleteSession(target.id);
      if (result.success) {
        project.sessions = project.sessions.filter((s) => s.id !== target.id);
        if (project.sessions.length > 0) {
          project.lastActive = project.sessions[0].updated;
        }
        console.log(pc.green(`✅ 已成功彻底删除会话: "${target.title}"\n`));
      } else {
        console.error(pc.red(`❌ 删除失败: ${result.error || "未知错误"}\n`));
      }
      await safePrompt(() =>
        input({
          message: "按回车键继续...",
        })
      );
    } else {
      console.log(pc.gray("已取消删除。\n"));
    }
  }

  console.log(pc.yellow("该项目已无历史会话。"));
  await safePrompt(() =>
    input({
      message: "按回车键返回...",
    })
  );
}

/**
 * Handle native Windows folder picker
 */
async function handleWindowsPicker(): Promise<void> {
  console.log(pc.cyan("\n正在打开 Windows 文件夹选择器..."));
  const picked = openWindowsFolderPicker();

  if (!picked) {
    console.log(pc.gray("未选择任何文件夹或已取消。"));
    return;
  }

  console.log(pc.green(`✅ 已选择文件夹: ${picked}`));
  recordFolderAccess(picked);

  const all = getAllProjects();
  const found = all.find((p) => p.directory.toLowerCase() === picked.toLowerCase()) || {
    directory: picked,
    displayName: path.basename(picked) || picked,
    exists: true,
    pinned: false,
    lastActive: Date.now(),
    sessions: [],
  };

  await handleProjectSelected(found);
}

/**
 * Quick search projects
 */
async function handleSearchProjects(projects: ProjectItem[]): Promise<void> {
  const keyword = await safePrompt(() =>
    input({
      message: "输入关键词搜索项目名称或路径:",
    })
  );

  if (!keyword || !keyword.trim()) return;

  const kw = keyword.trim().toLowerCase();
  const matched = projects.filter(
    (p) => p.displayName.toLowerCase().includes(kw) || p.directory.toLowerCase().includes(kw)
  );

  if (matched.length === 0) {
    console.log(pc.yellow(`未找到包含 "${keyword}" 的项目。`));
    await safePrompt(() =>
      input({
        message: "按回车继续...",
      })
    );
    return;
  }

  const choices = matched.map((p) => ({
    name: `${p.pinned ? "📌 " : "📂 "}${pc.bold(p.displayName)} ${pc.gray(`(${p.sessions.length}个会话)`)}`,
    value: p,
    description: p.directory,
  }));

  const headerLines = [
    pc.cyan("🔍 搜索结果: ") + pc.bold(`找到 ${matched.length} 个匹配项目`),
    "",
  ];

  const selected = await safePrompt(() =>
    mouseSelect<ProjectItem>({
      headerLines,
      message: `请选择项目:`,
      choices,
    })
  );

  if (selected) {
    await handleProjectSelected(selected);
  }
}

/**
 * View all historical project locations list
 */
async function handleViewAllLocations(projects: ProjectItem[]): Promise<void> {
  if (projects.length === 0) {
    console.clear();
    console.log(pc.yellow("暂无任何记忆的项目位置。\n"));
    await safePrompt(() =>
      input({
        message: "按回车返回主菜单...",
      })
    );
    return;
  }

  const headerLines: string[] = [
    `${pc.cyan("📋 全部已记忆的历史项目位置清单")}  ${pc.gray(`(共 ${projects.length} 个项目)`)}`,
  ];

  const choices: Array<{ name: string; value: ProjectItem | null; description?: string }> = projects.map((p, idx) => {
    const num = pc.cyan(`[${idx + 1}]`);
    const pinTag = p.pinned ? pc.yellow("📌 ") : "📁 ";
    const statusTag = p.exists ? pc.green("● 路径有效") : pc.red("○ 路径已失效");
    return {
      name: `${num} ${pinTag}${pc.bold(p.displayName)}  ${pc.cyan(`(${p.sessions.length} 会话)`)}  ${statusTag}`,
      value: p,
      description: `${p.directory}  |  最近活跃: ${formatRelativeTime(p.lastActive)}`,
    };
  });
  choices.push({
    name: pc.gray("🔙 返回主菜单"),
    value: null,
  });

  const picked = await safePrompt(() =>
    mouseSelect<ProjectItem | null>({
      headerLines,
      message: "请选择要直接操作的项目，或返回主菜单:",
      choices,
    })
  );

  if (picked) {
    await handleProjectSelected(picked);
  }
}
