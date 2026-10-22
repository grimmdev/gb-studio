import type { IncomingMessage, ServerResponse } from "http";
import Path from "path";
import fs from "fs-extra";
import os from "os";
import mime from "mime";
import loadProjectData from "lib/project/loadProjectData";
import saveProjectData from "lib/project/saveProjectData";
import { loadProjectResourceChecksums } from "lib/project/loadResourceChecksums";
import createProject from "lib/project/createProject";
import buildProject from "lib/compiler/buildProject";
import { getROMFilename } from "shared/lib/helpers/filePaths";
import { getBackgroundInfo, getSceneTilemapInfo } from "lib/helpers/validation";
import { compileSprite } from "lib/compiler/compileSprites";
import {
  assetsRoot,
  projectTemplatesRoot,
  localesRoot,
  musicTemplatesRoot,
  buildUUID,
} from "consts";
import getTmp from "lib/helpers/getTmp";
import { decompressProjectResources } from "shared/lib/resources/compression";
import { getGlobalPluginsPath } from "lib/pluginManager/globalPlugins";
import { assetFilename, type Asset, type AssetType } from "shared/lib/helpers/assets";
import { guardAssetWithinProject } from "lib/helpers/assets";
import { loadUGESong, saveUGESong } from "shared/lib/uge/ugeHelper";
import { convertMODDataToUGESong } from "shared/lib/uge/mod2uge/import";
import { writeFileWithBackupAsync } from "lib/helpers/fs/writeFileWithBackup";
import { loadMusicData } from "lib/project/loadMusicData";
import { TemplateManager } from "lib/templates/templateManager";
import { serverState, setOpenProject } from "./state";
import { startWatchingProject } from "./watcher";
import { broadcast } from "./ws";

const templateManager = new TemplateManager();

const parseJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
};

const sendJson = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
};

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

const sendFile = async (
  res: ServerResponse,
  filePath: string,
  contentType?: string,
) => {
  try {
    if (!(await fs.pathExists(filePath))) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = Path.join(filePath, "index.html");
      if (!(await fs.pathExists(filePath))) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
    }

    const type = contentType || getMimeType(filePath) || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error("Error serving file:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
};

export const handleApiRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = decodeURI(url.pathname);
  const method = req.method?.toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  // Assets serving
  if (pathname.startsWith("/api/assets/project/")) {
    const relPath = pathname.replace("/api/assets/project/", "");
    if (!serverState.projectRoot) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("No open project");
      return true;
    }
    const fullPath = Path.join(serverState.projectRoot, relPath);
    guardAssetWithinProject(fullPath, serverState.projectRoot);
    await sendFile(res, fullPath);
    return true;
  }

  if (pathname.startsWith("/api/assets/app/")) {
    const relPath = pathname.replace("/api/assets/app/", "");
    const fullPath = Path.join(assetsRoot, relPath);
    await sendFile(res, fullPath);
    return true;
  }

  if (pathname.startsWith("/api/assets/plugins/")) {
    const relPath = pathname.replace("/api/assets/plugins/", "");
    const fullPath = Path.join(getGlobalPluginsPath(), relPath);
    await sendFile(res, fullPath);
    return true;
  }

  // Preview runner serving (compiled HTML5 game)
  if (pathname.startsWith("/api/preview/")) {
    const relPath = pathname.replace("/api/preview/", "");
    const tmpPath = await getTmp();
    const tmpBuildDir = Path.join(tmpPath, buildUUID, "build", "web");
    const fullPath = Path.join(tmpBuildDir, relPath);
    await sendFile(res, fullPath);
    return true;
  }

  // API Endpoints
  const userProjectsDir =
    process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");

  if (pathname === "/api/projects" && method === "GET") {
    const templates = [
      { name: "Blank Project", path: Path.join(projectTemplatesRoot, "blank", "project.gbsproj") },
      { name: "GB HTML Sample", path: Path.join(projectTemplatesRoot, "gbhtml", "project.gbsproj") },
      { name: "GBS2 Sample", path: Path.join(projectTemplatesRoot, "gbs2", "project.gbsproj") },
    ];

    const userProjects: { name: string; path: string }[] = [];
    try {
      if (await fs.pathExists(userProjectsDir)) {
        const entries = await fs.readdir(userProjectsDir);
        for (const entry of entries) {
          const entryDir = Path.join(userProjectsDir, entry);
          const stat = await fs.stat(entryDir);
          if (stat.isDirectory()) {
            const files = await fs.readdir(entryDir);
            const projFile = files.find((f) => f.endsWith(".gbsproj"));
            if (projFile) {
              userProjects.push({
                name: entry,
                path: Path.join(entryDir, projFile),
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn("Failed scanning user projects dir", e);
    }

    sendJson(res, 200, {
      currentProject: serverState.projectPath,
      currentProjectRoot: serverState.projectRoot,
      templates,
      userProjects,
      projectsDir: userProjectsDir,
    });
    return true;
  }

  if (pathname === "/api/projects/open" && method === "POST") {
    const body = await parseJsonBody<{ projectPath: string }>(req);
    if (!body.projectPath || !(await fs.pathExists(body.projectPath))) {
      sendJson(res, 400, { error: "Project file does not exist" });
      return true;
    }
    setOpenProject(body.projectPath);
    startWatchingProject(body.projectPath);
    sendJson(res, 200, {
      success: true,
      projectPath: serverState.projectPath,
      projectRoot: serverState.projectRoot,
    });
    return true;
  }

  if (pathname === "/api/projects/load" && method === "GET") {
    const queryPath = url.searchParams.get("path");
    if (queryPath && (await fs.pathExists(queryPath))) {
      setOpenProject(queryPath);
      startWatchingProject(queryPath);
    }
    if (!serverState.projectPath) {
      sendJson(res, 400, { error: "No open project" });
      return true;
    }
    try {
      const data = await loadProjectData(serverState.projectPath);
      sendJson(res, 200, data);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/checksums" && method === "GET") {
    if (!serverState.projectPath) {
      sendJson(res, 400, { error: "No open project" });
      return true;
    }
    try {
      const checksums = await loadProjectResourceChecksums(serverState.projectPath);
      sendJson(res, 200, checksums);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/save" && method === "POST") {
    if (!serverState.projectPath) {
      sendJson(res, 400, { error: "No open project" });
      return true;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch = await parseJsonBody<any>(req);
      await saveProjectData(serverState.projectPath, patch, {
        progress: (completed, total) => {
          broadcast("project:save-progress", completed, total);
        },
      });
      sendJson(res, 200, { success: true });
    } catch (err: unknown) {
      console.error("Save project error:", err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/create" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = await parseJsonBody<any>(req);
      if (!input.path) {
        input.path = userProjectsDir;
      }
      await fs.ensureDir(input.path);
      const projectPath = await createProject(input);
      setOpenProject(projectPath);
      startWatchingProject(projectPath);
      sendJson(res, 200, { success: true, projectPath });
    } catch (err: unknown) {
      console.error("Create project error:", err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/build" && method === "POST") {
    if (!serverState.projectPath) {
      sendJson(res, 400, { error: "No open project" });
      return true;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<{ project: any; options: any }>(req);
      const projectRoot = serverState.projectRoot;
      const tmpPath = await getTmp();
      const outputRoot = Path.join(tmpPath, buildUUID);

      const progress = (message: string) => {
        console.log("[Build Progress]", message);
        broadcast("build:log", message);
      };
      const warnings = (message: string) => {
        console.warn("[Build Warning/Error]", message);
        broadcast("build:error", message);
      };

      const colorOnly = body.project.settings?.colorMode === "color";
      const buildType = body.options?.buildType || "web";

      let project = body.project;
      if (
        Array.isArray(project.scenes) &&
        typeof project.scenes[0]?.collisions === "string"
      ) {
        project = decompressProjectResources(project);
      }

      const romFilename = getROMFilename(
        body.project.settings?.romFilename,
        body.project.metadata?.name,
        colorOnly,
        buildType,
      );

      const result = await buildProject(project, {
        projectRoot,
        outputRoot,
        romFilename,
        tmpPath,
        buildType,
        engineSchema: body.options?.engineSchema,
        debugEnabled: body.options?.debugEnabled || false,
        make: true,
        progress,
        warnings,
      });

      sendJson(res, 200, result);
    } catch (err: unknown) {
      console.error("Build project error:", err);
      broadcast("build:error", err instanceof Error ? err.message : String(err));
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/background-info" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<any>(req);
      const info = await getBackgroundInfo(
        body.background,
        body.tileset,
        body.is360,
        body.uiPalette,
        body.colorMode,
        body.colorCorrection,
        body.autoTileFlipEnabled,
        serverState.projectRoot,
      );
      sendJson(res, 200, info);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/scene-tilemap-info" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<any>(req);
      const info = await getSceneTilemapInfo(
        body.scene,
        body.tilesets,
        body.colorMode,
        body.autoTileFlipEnabled,
        serverState.projectRoot,
      );
      sendJson(res, 200, info);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/projects/sprite-compile" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<any>(req);
      const projectRoot = serverState.projectRoot;
      const filename = assetFilename(projectRoot, "sprites", body.spriteData);
      guardAssetWithinProject(filename, projectRoot);
      const result = await compileSprite(
        { ...body.spriteData, colorMode: "mixed" },
        false,
        projectRoot,
        body.defaultSpriteMode,
      );
      sendJson(res, 200, result);
    } catch (err: unknown) {
      console.error("Sprite compile error:", err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/tracker/load" && method === "POST") {
    try {
      const body = await parseJsonBody<{ assetPath: string }>(req);
      const projectRoot = serverState.projectRoot;
      const filename = Path.join(projectRoot, body.assetPath);
      guardAssetWithinProject(filename, projectRoot);
      const data = await fs.readFile(filename);
      const song = loadUGESong(data);
      if (song) {
        song.filename = body.assetPath;
      }
      sendJson(res, 200, song);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/tracker/save" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<{ song: any }>(req);
      const projectRoot = serverState.projectRoot;
      const filename = Path.join(projectRoot, body.song.filename);
      guardAssetWithinProject(filename, projectRoot);
      const data = saveUGESong(body.song);
      await writeFileWithBackupAsync(filename, data);
      sendJson(res, 200, { success: true });
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/tracker/new" && method === "POST") {
    try {
      const body = await parseJsonBody<{ assetPath: string }>(req);
      const projectRoot = serverState.projectRoot;
      const filename = Path.join(projectRoot, body.assetPath);
      guardAssetWithinProject(filename, projectRoot);

      const templatePath = Path.join(musicTemplatesRoot, "template.uge");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const copy2 = async (oPath: string, targetPath: string): Promise<any> => {
        const exists = await fs.pathExists(targetPath);
        if (!exists) {
          await fs.copy(oPath, targetPath, {
            overwrite: false,
            errorOnExist: true,
          });
          const data = await loadMusicData(projectRoot)(targetPath);
          return data;
        } else {
          const ext = ".uge";
          if (!targetPath.endsWith(ext)) {
            throw new Error(`Invalid filename ${targetPath}`);
          }
          const baseName = targetPath.slice(0, targetPath.length - ext.length);
          const matches = baseName.match(/\d+$/);
          let newBaseName = `${baseName} 1`;
          if (matches) {
            const number = parseInt(matches[0], 10) + 1;
            newBaseName = baseName.replace(/\d+$/, `${number}`);
          }
          const newPath = `${newBaseName}.uge`;
          return await copy2(oPath, newPath);
        }
      };
      const result = await copy2(templatePath, filename);
      sendJson(res, 200, result);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/tracker/convert-mod" && method === "POST") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await parseJsonBody<{ asset: any }>(req);
      const projectRoot = serverState.projectRoot;
      const filename = assetFilename(projectRoot, "music", body.asset);
      const newFilename = filename.replace(/\.[^/.]+$/, ".uge");
      guardAssetWithinProject(filename, projectRoot);

      const modData = await fs.readFile(filename);
      const song = convertMODDataToUGESong(
        modData,
        !body.asset.settings?.disableSpeedConversion,
      );
      const ugeData = saveUGESong(song);
      await writeFileWithBackupAsync(newFilename, ugeData);

      const resourceData = await loadMusicData(projectRoot)(newFilename);
      sendJson(res, 200, resourceData);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === "/api/templates" && method === "GET") {
    try {
      const templates = templateManager.getPluginTemplates();
      sendJson(res, 200, templates);
    } catch (err: unknown) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname.startsWith("/api/l10n/")) {
    const locale = pathname.replace("/api/l10n/", "");
    const localePath = Path.join(localesRoot, `${locale || "en"}.json`);
    await sendFile(res, localePath, "application/json");
    return true;
  }

  return false;
};
