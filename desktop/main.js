// If the app was spawned from a terminal that exported ELECTRON_RUN_AS_NODE
// (the DSH shell does this), re-launch the same executable as a real Electron
// app before requiring the electron module.
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === "1") {
  const { spawn } = require("child_process");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
    detached: true,
    stdio: "ignore",
    env,
  }).unref();
  process.exit(0);
}

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");

const appRoot = app.isPackaged ? path.join(process.resourcesPath, "app") : __dirname;
const dataRoot = process.env.CODEX_STUDIO_DATA || "D:\\CodexStudioAppData";
const splashPath = path.join(appRoot, "splash.html");
let serverProcess = null;
let mainWindow = null;
let quitting = false;

// Electron defaults userData, GPU cache, session storage and crash dumps to
// C:\Users\...\AppData. Keep every Codex Studio-owned byte on D:.
for (const dir of [dataRoot, path.join(dataRoot, "session"), path.join(dataRoot, "logs"), path.join(dataRoot, "crash"), path.join(dataRoot, "tmp")]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
for (const [name, value] of [
  ["userData", dataRoot],
  ["sessionData", path.join(dataRoot, "session")],
  ["logs", path.join(dataRoot, "logs")],
  ["crashDumps", path.join(dataRoot, "crash")],
  ["temp", path.join(dataRoot, "tmp")],
]) {
  try { app.setPath(name, value); } catch (_) {}
}

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p)) || paths[0];
}

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const probe = net.createServer();
      probe.once("error", () => {
        port += 1;
        if (port > start + 40) reject(new Error("No free local port"));
        else tryPort();
      });
      probe.once("listening", () => probe.close(() => resolve(port)));
      probe.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() > deadline) return reject(new Error("Codex Studio backend did not start"));
      http.get(url + "/api/bootstrap", (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else setTimeout(poll, 350);
      }).on("error", () => setTimeout(poll, 350));
    };
    poll();
  });
}

function startBackend(port) {
  const python = firstExisting([
    path.join(appRoot, "python", "pythonw.exe"),
    path.join(appRoot, "python", "python.exe"),
  ]);
  const server = path.join(appRoot, "server.py");
  const config = path.join(appRoot, "config.json");
  if (!fs.existsSync(python)) throw new Error("Bundled Python runtime is missing");
  if (!fs.existsSync(server)) throw new Error("server.py is missing");
  if (!fs.existsSync(config)) throw new Error("config.json is missing");
  serverProcess = spawn(python, [server, "--config", config, "--port", String(port)], {
    cwd: appRoot,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      TMP: path.join(dataRoot, "tmp"),
      TEMP: path.join(dataRoot, "tmp"),
    },
  });
  serverProcess.on("error", (err) => {
    if (!quitting) dialog.showErrorBox("Codex Studio", "无法启动后端：\n" + err.message);
  });
  serverProcess.on("exit", (code) => {
    if (!quitting && code !== 0) {
      dialog.showErrorBox("Codex Studio", "后端意外退出，退出码 " + code + "。\n请检查 config.json。");
    }
  });
}

async function boot() {
  app.setName("Codex Studio");
  app.setAppUserModelId("local.codex.studio");
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#f7f4ee",
    autoHideMenuBar: true,
    title: "Codex Studio",
    icon: path.join(appRoot, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => { mainWindow = null; });
  if (fs.existsSync(splashPath)) await win.loadFile(splashPath);
  win.once("ready-to-show", () => win.show());
  try {
    const port = await findFreePort(Number(process.env.CODEX_STUDIO_PORT || 7788));
    startBackend(port);
    const url = "http://127.0.0.1:" + port;
    await waitForServer(url, 90000);
    await win.loadURL(url);
    win.show();
  } catch (err) {
    win.show();
    dialog.showErrorBox("Codex Studio", "启动失败：\n" + err.message);
    app.quit();
  }
}

app.whenReady().then(boot);
app.on("before-quit", () => {
  quitting = true;
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }
});
app.on("window-all-closed", () => app.quit());
