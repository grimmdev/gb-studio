import { Router, Request, Response } from "express";
import Path from "path";
import fs from "fs-extra";
import os from "os";
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
import { assetFilename } from "shared/lib/helpers/assets";
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

export const apiRouter = Router();

const sendFileSafe = async (res: Response, filePath: string) => {
  try {
    const resolvedPath = Path.resolve(filePath);
    if (!(await fs.pathExists(resolvedPath))) {
      res.status(404).send("Not Found");
      return;
    }
    const stat = await fs.stat(resolvedPath);
    let target = resolvedPath;
    if (stat.isDirectory()) {
      target = Path.join(resolvedPath, "index.html");
      if (!(await fs.pathExists(target))) {
        res.status(404).send("Not Found");
        return;
      }
    }
    res.sendFile(target);
  } catch (err) {
    console.error("Error sending file:", err);
    res.status(500).send("Internal Server Error");
  }
};

// --- Asset Serving ---
apiRouter.get("/assets/project/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  if (!serverState.projectRoot) {
    res.status(400).send("No open project");
    return;
  }
  const fullPath = Path.join(serverState.projectRoot, relPath);
  guardAssetWithinProject(fullPath, serverState.projectRoot);
  await sendFileSafe(res, fullPath);
});

apiRouter.get("/assets/app/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const fullPath = Path.join(assetsRoot, relPath);
  await sendFileSafe(res, fullPath);
});

apiRouter.get("/assets/plugins/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const fullPath = Path.join(getGlobalPluginsPath(), relPath);
  await sendFileSafe(res, fullPath);
});

// --- Preview runner serving (compiled HTML5 game) ---
apiRouter.get("/preview/*", async (req: Request, res: Response) => {
  const relPath = req.params[0] || (req.params as any)["0"] || "";
  const tmpPath = await getTmp();
  const tmpBuildDir = Path.join(tmpPath, buildUUID, "build", "web");
  const fullPath = Path.join(tmpBuildDir, relPath);
  await sendFileSafe(res, fullPath);
});

// --- Project Endpoints ---
const getUserProjectsDir = () =>
  process.env.PROJECTS_DIR || Path.join(os.homedir(), "GBStudioProjects");

apiRouter.get("/projects", async (_req: Request, res: Response) => {
  const userProjectsDir = getUserProjectsDir();
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

  res.json({
    currentProject: serverState.projectPath,
    currentProjectRoot: serverState.projectRoot,
    templates,
    userProjects,
    projectsDir: userProjectsDir,
  });
});

apiRouter.post("/projects/open", async (req: Request, res: Response) => {
  const { projectPath } = req.body || {};
  if (!projectPath || !(await fs.pathExists(projectPath))) {
    res.status(400).json({ error: "Project file does not exist" });
    return;
  }
  setOpenProject(projectPath);
  startWatchingProject(projectPath);
  res.json({
    success: true,
    projectPath: serverState.projectPath,
    projectRoot: serverState.projectRoot,
  });
});

apiRouter.get("/projects/load", async (req: Request, res: Response) => {
  const queryPath = req.query.path as string | undefined;
  if (queryPath && (await fs.pathExists(queryPath))) {
    setOpenProject(queryPath);
    startWatchingProject(queryPath);
  }
  if (!serverState.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const data = await loadProjectData(serverState.projectPath);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/projects/checksums", async (_req: Request, res: Response) => {
  if (!serverState.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const checksums = await loadProjectResourceChecksums(serverState.projectPath);
    res.json(checksums);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/save", async (req: Request, res: Response) => {
  if (!serverState.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const patch = req.body;
    await saveProjectData(serverState.projectPath, patch, {
      progress: (completed, total) => {
        broadcast("project:save-progress", completed, total);
      },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error("Save project error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/create", async (req: Request, res: Response) => {
  try {
    const input = req.body || {};
    if (!input.path) {
      input.path = getUserProjectsDir();
    }
    await fs.ensureDir(input.path);
    const projectPath = await createProject(input);
    setOpenProject(projectPath);
    startWatchingProject(projectPath);
    res.json({ success: true, projectPath });
  } catch (err: unknown) {
    console.error("Create project error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/build", async (req: Request, res: Response) => {
  if (!serverState.projectPath) {
    res.status(400).json({ error: "No open project" });
    return;
  }
  try {
    const { project: bodyProject, options } = req.body || {};
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

    const colorOnly = bodyProject.settings?.colorMode === "color";
    const buildType = options?.buildType || "web";

    let project = bodyProject;
    if (
      Array.isArray(project.scenes) &&
      typeof project.scenes[0]?.collisions === "string"
    ) {
      project = decompressProjectResources(project);
    }

    const romFilename = getROMFilename(
      bodyProject.settings?.romFilename,
      bodyProject.metadata?.name,
      colorOnly,
      buildType,
    );

    const result = await buildProject(project, {
      projectRoot,
      outputRoot,
      romFilename,
      tmpPath,
      buildType,
      engineSchema: options?.engineSchema,
      debugEnabled: options?.debugEnabled || false,
      make: true,
      progress,
      warnings,
    });

    res.json(result);
  } catch (err: unknown) {
    console.error("Build project error:", err);
    broadcast("build:error", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/background-info", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
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
    res.json(info);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/scene-tilemap-info", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const info = await getSceneTilemapInfo(
      body.scene,
      body.tilesets,
      body.colorMode,
      body.autoTileFlipEnabled,
      serverState.projectRoot,
    );
    res.json(info);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/projects/sprite-compile", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const projectRoot = serverState.projectRoot;
    const filename = assetFilename(projectRoot, "sprites", body.spriteData);
    guardAssetWithinProject(filename, projectRoot);
    const result = await compileSprite(
      { ...body.spriteData, colorMode: "mixed" },
      false,
      projectRoot,
      body.defaultSpriteMode,
    );
    res.json(result);
  } catch (err: unknown) {
    console.error("Sprite compile error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Tracker Endpoints ---
apiRouter.post("/tracker/load", async (req: Request, res: Response) => {
  try {
    const { assetPath } = req.body || {};
    const projectRoot = serverState.projectRoot;
    const filename = Path.join(projectRoot, assetPath);
    guardAssetWithinProject(filename, projectRoot);
    const data = await fs.readFile(filename);
    const song = loadUGESong(data);
    if (song) {
      song.filename = assetPath;
    }
    res.json(song);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/save", async (req: Request, res: Response) => {
  try {
    const { song } = req.body || {};
    const projectRoot = serverState.projectRoot;
    const filename = Path.join(projectRoot, song.filename);
    guardAssetWithinProject(filename, projectRoot);
    const data = saveUGESong(song);
    await writeFileWithBackupAsync(filename, data);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/new", async (req: Request, res: Response) => {
  try {
    const { assetPath } = req.body || {};
    const projectRoot = serverState.projectRoot;
    const filename = Path.join(projectRoot, assetPath);
    guardAssetWithinProject(filename, projectRoot);

    const templatePath = Path.join(musicTemplatesRoot, "template.uge");
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
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post("/tracker/convert-mod", async (req: Request, res: Response) => {
  try {
    const { asset } = req.body || {};
    const projectRoot = serverState.projectRoot;
    const filename = assetFilename(projectRoot, "music", asset);
    const newFilename = filename.replace(/\.[^/.]+$/, ".uge");
    guardAssetWithinProject(filename, projectRoot);

    const modData = await fs.readFile(filename);
    const song = convertMODDataToUGESong(
      modData,
      !asset.settings?.disableSpeedConversion,
    );
    const ugeData = saveUGESong(song);
    await writeFileWithBackupAsync(newFilename, ugeData);

    const resourceData = await loadMusicData(projectRoot)(newFilename);
    res.json(resourceData);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/templates", (_req: Request, res: Response) => {
  try {
    const templates = templateManager.getPluginTemplates();
    res.json(templates);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.get("/l10n/:locale", async (req: Request, res: Response) => {
  const locale = req.params.locale || "en";
  const localePath = Path.join(localesRoot, `${locale}.json`);
  await sendFileSafe(res, localePath);
});
