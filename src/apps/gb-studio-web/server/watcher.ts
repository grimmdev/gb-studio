import Path from "path";
import watchProject from "lib/project/watchProject";
import { loadSpriteData } from "lib/project/loadSpriteData";
import { loadBackgroundData } from "lib/project/loadBackgroundData";
import { loadMusicData } from "lib/project/loadMusicData";
import { loadSoundData } from "lib/project/loadSoundData";
import { loadFontData } from "lib/project/loadFontData";
import { loadAvatarData } from "lib/project/loadAvatarData";
import { loadEmoteData } from "lib/project/loadEmoteData";
import { loadTilesetData } from "lib/project/loadTilesetData";
import { loadEngineSchema } from "lib/project/loadEngineSchema";
import loadAllScriptEventHandlers from "lib/project/loadScriptEventHandlers";
import { cloneDictionary } from "lib/helpers/clone";
import { listProjectWebTemplates } from "lib/compiler/webBuild";
import parseAssetPath from "shared/lib/assets/parseAssetPath";
import { broadcast } from "./ws";
import { serverState } from "./state";

let activeWatcher: ReturnType<typeof watchProject> | null = null;

export const startWatchingProject = (projectPath: string) => {
  if (activeWatcher) {
    try {
      activeWatcher();
    } catch (e) {
      console.error("Error stopping watcher:", e);
    }
    activeWatcher = null;
  }

  const projectRoot = Path.dirname(projectPath);

  activeWatcher = watchProject(projectPath, {
    onChangedSprite: async (filename: string) => {
      const data = await loadSpriteData(projectRoot)(filename);
      if (data) {
        broadcast("watch:sprite:changed", filename, data);
      }
    },
    onChangedBackground: async (filename: string) => {
      const data = await loadBackgroundData(projectRoot)(filename);
      if (data) {
        broadcast("watch:background:changed", filename, data);
      }
    },
    onChangedUI: (filename: string) => {
      broadcast("watch:ui:changed", { filename });
    },
    onChangedMusic: async (filename: string) => {
      const data = await loadMusicData(projectRoot)(filename);
      if (data) {
        broadcast("watch:music:changed", filename, data);
      }
    },
    onChangedSound: async (filename: string) => {
      const data = await loadSoundData(projectRoot)(filename);
      if (data) {
        broadcast("watch:sound:changed", filename, data);
      }
    },
    onChangedFont: async (filename: string) => {
      const data = await loadFontData(projectRoot)(filename);
      if (data) {
        broadcast("watch:font:changed", filename, data);
      }
    },
    onChangedAvatar: async (filename: string) => {
      const data = await loadAvatarData(projectRoot)(filename);
      if (data) {
        broadcast("watch:avatar:changed", filename, data);
      }
    },
    onChangedEmote: async (filename: string) => {
      const data = await loadEmoteData(projectRoot)(filename);
      if (data) {
        broadcast("watch:emote:changed", filename, data);
      }
    },
    onChangedTileset: async (filename: string) => {
      const data = await loadTilesetData(projectRoot)(filename);
      if (data) {
        broadcast("watch:tileset:changed", filename, data);
      }
    },
    onRemoveSprite: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "sprites");
      broadcast("watch:sprite:removed", file, plugin);
    },
    onRemoveBackground: async (filename: string) => {
      const { file, plugin } = parseAssetPath(
        filename,
        projectRoot,
        "backgrounds",
      );
      broadcast("watch:background:removed", file, plugin);
    },
    onRemoveUI: async (filename: string) => {
      broadcast("watch:ui:removed", filename);
    },
    onRemoveMusic: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "music");
      broadcast("watch:music:removed", file, plugin);
    },
    onRemoveSound: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "sounds");
      broadcast("watch:sound:removed", file, plugin);
    },
    onRemoveFont: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "fonts");
      broadcast("watch:font:removed", file, plugin);
    },
    onRemoveAvatar: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "avatars");
      broadcast("watch:avatar:removed", file, plugin);
    },
    onRemoveEmote: async (filename: string) => {
      const { file, plugin } = parseAssetPath(filename, projectRoot, "emotes");
      broadcast("watch:emote:removed", file, plugin);
    },
    onRemoveTileset: async (filename: string) => {
      const { file, plugin } = parseAssetPath(
        filename,
        projectRoot,
        "tilesets",
      );
      broadcast("watch:tileset:removed", file, plugin);
    },
    onChangedEngineSchema: async (_filename: string) => {
      const engineSchema = await loadEngineSchema(projectRoot);
      broadcast("watch:engineSchema:changed", engineSchema);
    },
    onChangedEventPlugin: async (_filename: string) => {
      const scriptEventHandlers = await loadAllScriptEventHandlers(projectRoot);
      broadcast(
        "watch:scriptEventDefs:changed",
        cloneDictionary(scriptEventHandlers),
      );
    },
    onChangedWebTemplates: async () => {
      const templates = await listProjectWebTemplates(projectRoot);
      broadcast("watch:webTemplates:changed", templates);
    },
  });

  return activeWatcher;
};
