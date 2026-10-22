/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require("webpack");
const { appPath, repoPath, srcPath } = require("../shared/webpack.paths");
const rules = require("../shared/webpack.rules");
const pkg = require("../../../package.json");
const { GitRevisionPlugin } = require("git-revision-webpack-plugin");

const isProduction = process.env.NODE_ENV === "production";

let gitVersion = pkg.version;
let gitCommitHash = "";
try {
  const gitRevisionPlugin = new GitRevisionPlugin({
    commithashCommand: "rev-list --max-count=1 --no-merges --abbrev-commit HEAD",
  });
  gitVersion = gitRevisionPlugin.version();
  gitCommitHash = gitRevisionPlugin.commithash();
} catch (_e) {
  // Git metadata unavailable
}

const docsUrl = "https://www.gbstudio.dev/docs/";

module.exports = {
  target: "node",
  mode: isProduction ? "production" : "development",
  node: {
    __dirname: false,
    __filename: false,
  },
  entry: {
    server: appPath("gb-studio-web", "server", "index.ts"),
    buildWorker: srcPath("lib", "compiler", "buildWorker.ts"),
  },
  output: {
    filename: (pathData) => {
      if (pathData.chunk.name === "server") {
        return "server.js";
      }
      return "[name].js";
    },
    path: repoPath("out", "web"),
    publicPath: __dirname,
  },
  module: {
    rules,
  },
  plugins: [
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
    new webpack.DefinePlugin({
      GIT_VERSION: JSON.stringify(gitVersion),
      COMMITHASH: JSON.stringify(gitCommitHash),
      VERSION: JSON.stringify(pkg.version),
      RELEASE_VERSION: JSON.stringify(pkg.version.replace(/-rc.*/, "")),
      DOCS_URL: JSON.stringify(docsUrl),
      "process.env.NODE_ENV": JSON.stringify(
        isProduction ? "production" : "development",
      ),
    }),
  ],
  ignoreWarnings: [
    {
      module: /express[\\/]lib[\\/]view\.js/,
    },
    {
      module: /ws[\\/]lib/,
    },
  ],
  externals: {
    bufferutil: "bufferutil",
    "utf-8-validate": "utf-8-validate",
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"],
    alias: {
      store: srcPath("store"),
      components: srcPath("components"),
      lang: srcPath("lang"),
      lib: srcPath("lib"),
      ui: srcPath("components", "ui"),
      shared: srcPath("shared"),
      consts: srcPath("consts.ts"),
      electron: srcPath("lib", "electronShim.ts"),
      "#my-quickjs-variant":
        require.resolve("@jitl/quickjs-singlefile-cjs-release-sync"),
    },
  },
};
