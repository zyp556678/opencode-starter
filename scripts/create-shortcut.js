const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const desktop = path.join(os.homedir(), "Desktop");
const shortcutPath = path.join(desktop, "OpenCode Launcher.lnk");
const releaseExe = path.resolve(__dirname, "..", "release", "opencode-launcher.exe");
const targetScript = path.resolve(__dirname, "launch.bat");
const workingDir = path.resolve(__dirname, "..");
const iconPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "shell32.dll");

const targetApp = fs.existsSync(releaseExe) ? releaseExe : targetScript;

// Ensure launch.bat has strict CRLF
if (fs.existsSync(targetScript)) {
  const content = fs.readFileSync(targetScript, "utf8");
  fs.writeFileSync(targetScript, content.replace(/\r?\n/g, "\r\n"), "utf8");
}

// Write temporary VBScript to create shortcut
const vbsPath = path.join(os.tmpdir(), "create_shortcut.vbs");
const vbsContent = [
  'Set oWS = CreateObject("WScript.Shell")',
  `Set oLink = oWS.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")`,
  `oLink.TargetPath = "${targetApp.replace(/\\/g, "\\\\")}"`,
  `oLink.WorkingDirectory = "${workingDir.replace(/\\/g, "\\\\")}"`,
  `oLink.Description = "OpenCode Launcher"`,
  `oLink.IconLocation = "${iconPath.replace(/\\/g, "\\\\")}, 220"`,
  "oLink.Save",
].join("\r\n");

fs.writeFileSync(vbsPath, vbsContent, "utf8");

try {
  execSync(`cscript //Nologo "${vbsPath}"`);
  console.log("SUCCESS: Shortcut updated at", shortcutPath);
} finally {
  try {
    fs.unlinkSync(vbsPath);
  } catch {}
}
