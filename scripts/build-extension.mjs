import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "packages", "vscode", "dist");
await mkdir(destination, { recursive: true });
await build({
  entryPoints: [resolve(root, "packages", "vscode", "src", "extension.ts")],
  outfile: resolve(destination, "extension.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external: ["vscode"],
});
await rm(resolve(destination, "bridge"), { recursive: true, force: true });
await cp(resolve(root, "dist", "bridge"), resolve(destination, "bridge"), {
  recursive: true,
  force: true,
});
await cp(
  resolve(root, "LICENSE"),
  resolve(root, "packages", "vscode", "LICENSE"),
);
await cp(
  resolve(root, "THIRD-PARTY-NOTICES"),
  resolve(root, "packages", "vscode", "THIRD-PARTY-NOTICES"),
);
await cp(
  resolve(root, "CHANGELOG.md"),
  resolve(root, "packages", "vscode", "CHANGELOG.md"),
);
await mkdir(resolve(root, "packages", "vscode", "licenses"), {
  recursive: true,
});
await cp(
  resolve(root, "node_modules", "prettier", "LICENSE"),
  resolve(root, "packages", "vscode", "licenses", "PRETTIER-LICENSE.txt"),
);
await cp(
  resolve(root, "node_modules", "prettier", "THIRD-PARTY-NOTICES.md"),
  resolve(
    root,
    "packages",
    "vscode",
    "licenses",
    "PRETTIER-THIRD-PARTY-NOTICES.md",
  ),
);
const ownLicense = await readFile(resolve(root, "LICENSE"), "utf8");
await writeFile(
  resolve(root, "packages", "vscode", "licenses", "BICEP-LICENSE.txt"),
  ownLicense.replace(
    "Copyright (c) 2026 Prettier Plugin Bicep contributors",
    "Copyright (c) Microsoft Corporation.",
  ),
);
const manifest = JSON.parse(
  await readFile(resolve(root, "packages", "vscode", "package.json"), "utf8"),
);
if (
  !manifest.contributes.configuration.properties[
    "bicepFlex.bicepSortDeclarations"
  ]
) {
  throw new Error(
    "VS Code option schema is missing. Run npm run configuration:generate.",
  );
}
