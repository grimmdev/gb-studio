import http from "http";
import Path from "path";
import fs from "fs-extra";
import mime from "mime";
import { handleApiRoutes } from "./routes";
import { initWebSocketServer } from "./ws";
import { setOpenProject } from "./state";
import { startWatchingProject } from "./watcher";
import { projectTemplatesRoot } from "consts";
import pkg from "../../../../package.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.VERSION) g.VERSION = pkg.version;
if (!g.RELEASE_VERSION) g.RELEASE_VERSION = pkg.version;

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const WEB_DIST = Path.resolve(__dirname, "../../../../out/web");

// Default initial project for development/demo (e.g. gbhtml sample or env)
const defaultProject =
  process.env.DEFAULT_PROJECT ||
  Path.join(projectTemplatesRoot, "gbhtml", "project.gbsproj");

if (fs.existsSync(defaultProject)) {
  console.log(`Setting default active project: ${defaultProject}`);
  setOpenProject(defaultProject);
  startWatchingProject(defaultProject);
}

const getMimeType = (filePath: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mime as any;
  if (typeof m.getType === "function") return m.getType(filePath);
  if (typeof m.lookup === "function") return m.lookup(filePath);
  const ext = Path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".html") return "text/html";
  if (ext === ".js") return "application/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".json") return "application/json";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
};

const server = http.createServer(async (req, res) => {
  // Handle API routes
  const handled = await handleApiRoutes(req, res);
  if (handled) {
    return;
  }

  // Static web frontend files
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let filePath = Path.join(WEB_DIST, decodeURI(url.pathname));

  if (await fs.pathExists(filePath)) {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = Path.join(filePath, "index.html");
    }
  }

  if (await fs.pathExists(filePath)) {
    const contentType = getMimeType(filePath) || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback to index.html
  const indexPath = Path.join(WEB_DIST, "index.html");
  if (await fs.pathExists(indexPath)) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  // If web frontend has not been compiled yet, show a welcome / status page
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
  <head>
    <title>GB Studio Web Server</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #1a1a24; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: #262636; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 500px; }
      h1 { color: #58a6ff; margin-top: 0; }
      code { background: #111; padding: 0.2rem 0.4rem; border-radius: 4px; color: #7ee787; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>GB Studio Web API Server</h1>
      <p>Backend API server is running on <code>http://${HOST}:${PORT}</code>.</p>
      <p>WebSocket hub is active on <code>ws://${HOST}:${PORT}/ws</code>.</p>
      <p>Active project: <code>${defaultProject}</code></p>
    </div>
  </body>
</html>`);
});

initWebSocketServer(server);

server.listen(PORT, HOST, () => {
  console.log(`🚀 GB Studio Web Server running at http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket endpoint ready at ws://${HOST}:${PORT}/ws`);
});
