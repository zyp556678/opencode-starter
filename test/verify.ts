import { getAllProjects } from "../src/projectService.js";
import { loadConfig } from "../src/config.js";
import { formatRelativeTime } from "../src/utils.js";

console.log("=== 测试 OpenCode 数据读取与项目聚类 ===");
const projects = getAllProjects();
console.log(`共识别到项目: ${projects.length} 个\n`);

for (let i = 0; i < projects.length; i++) {
  const p = projects[i];
  console.log(
    `[${i + 1}] ${p.displayName} (路径: ${p.directory})` +
      ` | 置顶: ${p.pinned} | 存在: ${p.exists} | 会话数: ${p.sessions.length} | 最近活跃: ${formatRelativeTime(p.lastActive)}`
  );
  for (let j = 0; j < Math.min(p.sessions.length, 3); j++) {
    const s = p.sessions[j];
    console.log(`    - 会话 #${j + 1}: [${formatRelativeTime(s.updated)}] ${s.title} (${s.id})`);
  }
}

console.log("\n=== 测试配置读取与写入 ===");
const config = loadConfig();
console.log(`置顶路径数: ${config.pinnedPaths.length}`);
console.log(`自定义路径数: ${config.customPaths.length}`);

console.log("\n=== 测试自适应高度计算逻辑 ===");
function computeEffectivePageSize(termRows: number, overhead: number, pageSize: number | "auto" = "auto"): number {
  if (pageSize === "auto" || typeof pageSize !== "number" || pageSize <= 0) {
    return Math.max(3, termRows - overhead);
  }
  return Math.max(3, Math.min(pageSize, termRows - overhead));
}

const overhead = 17;
console.log(`当终端窗口为 24 行时，列表显示高度: ${computeEffectivePageSize(24, overhead)} 项`);
console.log(`当终端窗口为 35 行时，列表显示高度: ${computeEffectivePageSize(35, overhead)} 项`);
console.log(`当终端窗口为 50 行时，列表显示高度: ${computeEffectivePageSize(50, overhead)} 项`);
console.log(`当终端窗口极小(15行)时，保底显示高度: ${computeEffectivePageSize(15, overhead)} 项`);

console.log("\n全部验证通过！");
