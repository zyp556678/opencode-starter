const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ResEdit = require("resedit");

console.log("=========================================");
console.log("   🚀 开始打包 OpenCode 独立免安装版 (.exe) ");
console.log("=========================================\n");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const distDir = path.join(rootDir, "dist");
const seaConfigFile = path.join(rootDir, "sea-config.json");
const seaBlobFile = path.join(distDir, "sea-prep.blob");
const targetExe = path.join(releaseDir, "opencode-launcher.exe");
const oclExe = path.join(releaseDir, "ocl.exe");
const zipFile = path.join(releaseDir, "OpenCode-Launcher-Windows-x64.zip");

// 1. Ensure directories
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// 2. Build TypeScript bundle
console.log("1/7 正在编译最新代码 (npm run build)...");
execSync("npm run build", { cwd: rootDir, stdio: "inherit" });

// 3. Generate SEA preparation blob
console.log("2/7 正在生成 SEA 二进制数据包 (sea-prep.blob)...");
fs.writeFileSync(
  seaConfigFile,
  JSON.stringify(
    {
      main: "dist/index.cjs",
      output: "dist/sea-prep.blob",
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  ),
  "utf8"
);
execSync(`node --experimental-sea-config "${seaConfigFile}"`, { cwd: rootDir, stdio: "inherit" });

// 4. Copy Node.js runtime executable
console.log("3/7 正在复制原生运行时 (node.exe -> opencode-launcher.exe)...");
try {
  execSync("taskkill /f /im opencode-launcher.exe /im ocl.exe", { stdio: "ignore" });
} catch {}
const nodePath = process.execPath;
fs.copyFileSync(nodePath, targetExe);

// 5. Strip PE Authenticode digital signature
console.log("4/7 正在剥离原数字签名以支持资源重构...");
const exeBuf = fs.readFileSync(targetExe);
const peOffset = exeBuf.readUInt32LE(0x3c);
const secDirOffset = peOffset + 24 + 112 + 4 * 8;
const secAddr = exeBuf.readUInt32LE(secDirOffset);
exeBuf.writeUInt32LE(0, secDirOffset);
exeBuf.writeUInt32LE(0, secDirOffset + 4);
const strippedExe = exeBuf.subarray(0, secAddr > 0 ? secAddr : exeBuf.length);

// 6. Inject NODE_SEA_BLOB and Update Version Info using resedit
console.log("5/7 正在通过 ResEdit 注入 SEA 资源并更新程序元信息...");
const exe = ResEdit.NtExecutable.from(strippedExe);
const res = ResEdit.NtExecutableResource.from(exe);
const blob = fs.readFileSync(seaBlobFile);

// Add NODE_SEA_BLOB resource (type 10 = RT_RCDATA)
res.entries.push({
  type: 10,
  id: "NODE_SEA_BLOB",
  lang: 1033,
  codepage: 0,
  bin: blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
});

// Update VersionInfo
try {
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length > 0) {
    const vi = viList[0];
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: "OpenCode 终端启动器",
        ProductName: "OpenCode Launcher",
        LegalCopyright: "OpenCode Community",
        ProductVersion: "1.0.0.0",
        OriginalFilename: "opencode-launcher.exe",
      }
    );
    vi.outputToResourceEntries(res.entries);
  }
} catch (e) {
  console.warn("更新版本信息跳过:", e.message);
}

res.outputResource(exe);
const newBinary = Buffer.from(exe.generate());

// 7. Enable SEA fuse (turn :0 into :1)
console.log("6/7 正在激活独立可执行模式 (SEA Fuse)...");
const fuse = Buffer.from("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0", "ascii");
const fuseIdx = newBinary.indexOf(fuse);
if (fuseIdx === -1) {
  throw new Error("未在二进制文件中找到 SEA Fuse 特征码");
}
newBinary[fuseIdx + fuse.length - 1] = 0x31; // '1'
fs.writeFileSync(targetExe, newBinary);

// Also copy as ocl.exe
fs.copyFileSync(targetExe, oclExe);

// 8. Create companion launcher script and README
console.log("7/7 正在生成辅助启动脚本与压缩包...");
const batContent = [
  "@echo off",
  "chcp 65001 >nul",
  "title OpenCode Launcher",
  'cd /d "%~dp0"',
  "opencode-launcher.exe %*",
  "if %ERRORLEVEL% NEQ 0 (",
  "    echo.",
  "    echo [OpenCode Launcher] 进程已退出，按任意键关闭...",
  "    pause >nul",
  ")",
].join("\r\n");
fs.writeFileSync(path.join(releaseDir, "启动 OpenCode.bat"), batContent, "utf8");

const readmeContent = [
  "==================================================",
  "       OpenCode 独立免安装版启动器 (Windows x64)",
  "==================================================",
  "",
  "【简介】",
  "本程序是针对 OpenCode 打造的免安装独立客户端启动器。",
  "无需在目标电脑上安装 Node.js、npm 或任何外部运行环境，解压即用。",
  "",
  "【包含文件】",
  "  • opencode-launcher.exe  - 独立主执行程序（双击直接运行）",
  "  • ocl.exe                - 同主程序，方便终端输入快捷命令",
  "  • 启动 OpenCode.bat      - 备用一键双击启动脚本（自动适配 UTF-8 终端）",
  "",
  "【使用方法】",
  "1. 在任意 Windows 64 位系统电脑上，双击【opencode-launcher.exe】或【启动 OpenCode.bat】即可直接启动！",
  "2. 可以将【opencode-launcher.exe】发送桌面快捷方式，方便随时使用。",
  "3. 支持键盘方向键选择项目、选择对应历史会话、新建会话或打开新文件夹。",
  "",
  "【系统要求】",
  "  • 操作系统: 64位 Windows 10 / Windows 11 / Windows Server",
  "  • 目标电脑上只需安装有 OpenCode CLI（opencode）即可无缝对接执行。",
  "",
].join("\r\n");
fs.writeFileSync(path.join(releaseDir, "使用说明.txt"), readmeContent, "utf8");

// Generate ZIP package for easy distribution
try {
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }
  const zipScript = `Compress-Archive -Path '${targetExe}','${oclExe}','${path.join(releaseDir, "启动 OpenCode.bat")}','${path.join(releaseDir, "使用说明.txt")}' -DestinationPath '${zipFile}' -Force`;
  execSync(`powershell -NoProfile -Command "${zipScript}"`, { stdio: "inherit" });
  console.log(`\n🎉 打包完成！已生成压缩包: ${zipFile}`);
} catch (err) {
  console.log("\n🎉 打包完成！(已在 release 目录生成 exe 文件)");
}

const stats = fs.statSync(targetExe);
console.log(`📦 单文件 exe 路径: ${targetExe} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
