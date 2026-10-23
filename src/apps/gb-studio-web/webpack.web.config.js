/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const { GitRevisionPlugin } = require("git-revision-webpack-plugin");
const fs = require("fs");
const { repoPath, srcPath } = require("../shared/webpack.paths");
const pkg = require("../../../package.json");

const isProduction = process.env.NODE_ENV === "production";

let gitVersion = pkg.version;
let gitCommitHash = "";
if (fs.existsSync(repoPath(".git"))) {
  try {
    const gitRevisionPlugin = new GitRevisionPlugin({
      commithashCommand:
        "rev-list --max-count=1 --no-merges --abbrev-commit HEAD",
    });
    gitVersion = gitRevisionPlugin.version();
    gitCommitHash = gitRevisionPlugin.commithash();
  } catch (_e) {
    // Git metadata unavailable in build environment
  }
}

const docsUrl = "https://www.gbstudio.dev/docs/";

const webRules = [
  {
    test: /\.(ts|tsx|js|jsx)$/,
    exclude: /(node_modules|\.webpack)/,
    use: [
      {
        loader: require.resolve("ts-loader"),
        options: {
          transpileOnly: true,
        },
      },
    ],
  },
  {
    test: /\.css$/i,
    use: [require.resolve("style-loader"), require.resolve("css-loader")],
  },
  {
    test: /\.(png|jpe?g|gif|mp4|woff2)$/i,
    exclude: /(node_modules|\.webpack)/,
    type: "asset/resource",
    generator: {
      filename: "assets/[name].[contenthash:8][ext]",
    },
  },
  {
    test: /\.(asm|inc)$/i,
    exclude: /(node_modules|\.webpack)/,
    type: "asset/source",
  },
  {
    test: /[\\/]appData[\\/]wasm[\\/](.*)[\\/](.*)\.wasm$/,
    type: "asset/resource",
    generator: {
      filename: "wasm/[name].[contenthash:8][ext]",
    },
  },
];

module.exports = {
  mode: isProduction ? "production" : "development",
  target: "web",
  entry: {
    bundle: "./src/apps/gb-studio-web/client/WebRoot.tsx",
  },
  output: {
    path: repoPath("out", "web"),
    filename: "[name].js",
    clean: true,
  },
  module: {
    rules: webRules,
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".wasm", ".css", ".json"],
    alias: {
      store: srcPath("store"),
      components: srcPath("components"),
      lang: srcPath("lang"),
      lib: srcPath("lib"),
      ui: srcPath("components", "ui"),
      renderer: srcPath("renderer"),
      shared: srcPath("shared"),
      assets: srcPath("assets"),
      consts: srcPath("consts.ts"),
      wasm: repoPath("appData", "wasm"),
      "contributors.json": repoPath("contributors.json"),
      "contributors-external.json": repoPath("contributors-external.json"),
      "patrons.json": repoPath("patrons.json"),
      electron: srcPath("lib", "electronShim.ts"),
      "#my-quickjs-variant":
        require.resolve("@jitl/quickjs-singlefile-browser-release-sync"),
    },
    fallback: {
      path: require.resolve("path-browserify"),
      buffer: require.resolve("buffer"),
      fs: false,
      child_process: false,
      os: false,
      net: false,
      tls: false,
      crypto: false,
      stream: false,
    },
  },
  plugins: [
    new webpack.DefinePlugin({
      GIT_VERSION: JSON.stringify(gitVersion),
      COMMITHASH: JSON.stringify(gitCommitHash),
      VERSION: JSON.stringify(pkg.version),
      RELEASE_VERSION: JSON.stringify(pkg.version.replace(/-rc.*/, "")),
      DOCS_URL: JSON.stringify(docsUrl),
    }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
      process: [srcPath("lib", "processShim.ts"), "default"],
    }),
    new CopyPlugin({
      patterns: [
        {
          from: "src/apps/gb-studio-web/client/index.html",
          to: "index.html",
        },
      ],
    }),
  ],
};
