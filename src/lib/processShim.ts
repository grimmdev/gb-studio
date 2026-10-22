const browserProcess = {
  env: {
    NODE_ENV: "production",
    GB_STUDIO_ROOT: "",
  },
  platform: "browser",
  browser: true,
  version: "",
  cwd: () => "/",
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    setTimeout(() => fn(...args), 0);
  },
};

export default browserProcess;
