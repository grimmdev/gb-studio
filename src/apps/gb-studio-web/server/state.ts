import Path from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { assetsRoot } from "consts";

export interface ServerState {
  projectPath: string;
  projectRoot: string;
  watcher: FSWatcher | null;
  cancelBuild: (() => void) | null;
}

export const serverState: ServerState = {
  projectPath: "",
  projectRoot: "",
  watcher: null,
  cancelBuild: null,
};

export const setOpenProject = (projectPath: string) => {
  serverState.projectPath = Path.resolve(projectPath);
  serverState.projectRoot = Path.dirname(serverState.projectPath);
};

export const getOpenProjectRoot = (): string => {
  return serverState.projectRoot;
};

export const getOpenProjectPath = (): string => {
  return serverState.projectPath;
};
