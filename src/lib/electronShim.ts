import Path from "path";
import os from "os";

const clipboardMemory = {
  text: "",
  buffers: new Map<string, Buffer>(),
};

export const app = {
  isReady: () => true,
  whenReady: () => Promise.resolve(true),
  on: () => {},
  quit: () => {},
  getPath: (name: string) => {
    if (name === "userData") {
      return (
        process.env.GB_STUDIO_USER_DATA || Path.join(os.homedir(), ".gb-studio")
      );
    }
    if (name === "documents") {
      return Path.join(os.homedir(), "Documents");
    }
    return os.tmpdir();
  },
  addRecentDocument: () => {},
  clearRecentDocuments: () => {},
  getLocale: () => "en",
};

export const dialog = {
  showMessageBoxSync: () => 0,
  showOpenDialogSync: () => [],
  showErrorBox: (title: string, content: string) => {
    console.error(`[Dialog Error] ${title}: ${content}`);
  },
  showSaveDialogSync: () => undefined,
};

export const shell = {
  openPath: async (path: string) => {
    console.log(`[Shell OpenPath] ${path}`);
    return "";
  },
  openExternal: async (url: string) => {
    console.log(`[Shell OpenExternal] ${url}`);
  },
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  off: () => {},
};

export const nativeTheme = {
  shouldUseDarkColors: true,
  on: () => {},
};

export const clipboard = {
  readText: () => clipboardMemory.text,
  writeText: (val: string) => {
    clipboardMemory.text = val;
  },
  readBuffer: (format: string) =>
    clipboardMemory.buffers.get(format) || Buffer.alloc(0),
  writeBuffer: (format: string, buffer: Buffer) => {
    clipboardMemory.buffers.set(format, buffer);
  },
};

export const protocol = {
  registerSchemesAsPrivileged: () => {},
  registerFileProtocol: () => {},
};

export const BrowserWindow = class {
  static getFocusedWindow() {
    return null;
  }
};

export default {
  app,
  dialog,
  shell,
  ipcMain,
  nativeTheme,
  clipboard,
  protocol,
  BrowserWindow,
};
