import path from "path";
import l10n from "shared/lib/lang/l10n";

export const isAssetWithinProject = (
  assetPath: string,
  projectRoot: string,
) => {
  const absoluteParentPath = path.resolve(projectRoot);
  const absoluteChildPath = path.resolve(assetPath);

  if (process.platform === "win32") {
    const parentLower = absoluteParentPath.toLowerCase();
    const childLower = absoluteChildPath.toLowerCase();
    if (parentLower === childLower) {
      return true;
    }
    const relative = path.relative(parentLower, childLower);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  if (absoluteParentPath === absoluteChildPath) {
    return true;
  }
  const relative = path.relative(absoluteParentPath, absoluteChildPath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const guardAssetWithinProject = (
  assetPath: string,
  projectRoot: string,
) => {
  if (!isAssetWithinProject(assetPath, projectRoot)) {
    throw new Error(l10n("ERROR_ASSET_DOESNT_BELONG_TO_CURRENT_PROJECT"));
  }
};
