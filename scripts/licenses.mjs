import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const assets = JSON.parse(
  await readFile(
    resolve("native", "Bicep.Formatter", "obj", "project.assets.json"),
    "utf8",
  ),
);
const roots = Object.keys(assets.packageFolders);
const notices = [
  "Third-party dependencies bundled with the Bicep formatter bridge.",
  "Generated from the locked NuGet restore. The .NET runtime is not bundled.",
  "",
];
for (const [id, library] of Object.entries(assets.libraries)) {
  if (library.type !== "package") continue;
  let folder;
  let nuspec;
  const specFile = library.files.find((file) => file.endsWith(".nuspec"));
  for (const root of roots) {
    try {
      nuspec = await readFile(join(root, library.path, specFile), "utf8");
      folder = join(root, library.path);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!folder || !nuspec)
    throw new Error(`Cannot locate restored license metadata for ${id}.`);
  const license = nuspec.match(/<license\b([^>]*)>([\s\S]*?)<\/license>/i);
  const licenseUrl = nuspec.match(/<licenseUrl>([\s\S]*?)<\/licenseUrl>/i)?.[1];
  const copyright = nuspec.match(/<copyright>([\s\S]*?)<\/copyright>/i)?.[1];
  const authors = nuspec.match(/<authors>([\s\S]*?)<\/authors>/i)?.[1];
  notices.push(
    `===== ${id} =====`,
    `Authors: ${authors ?? "See package metadata"}`,
  );
  if (copyright) notices.push(copyright);
  if (license)
    notices.push(`License (${license[1].trim()}): ${license[2].trim()}`);
  if (licenseUrl) notices.push(`License URL: ${licenseUrl}`);
  if (!license && !licenseUrl)
    throw new Error(
      `No license declaration for ${id}; review before distributing.`,
    );
  const files = library.files.filter((file) =>
    /(^|[/\\])(licen[cs]e|notices?|copyright|third[-_. ]?party[-_. ]?notices?)([.\-_]|$)/i.test(
      file,
    ),
  );
  if (license?.[1].includes('"file"') && !files.includes(license[2].trim()))
    files.push(license[2].trim());
  for (const file of files) {
    notices.push(`--- ${file} ---`, await readFile(join(folder, file), "utf8"));
  }
  notices.push("");
}
notices.push(
  "SPDX license texts for packages declaring license expressions:",
  "MIT: https://opensource.org/license/mit",
  "Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0",
  "BSD-2-Clause: https://opensource.org/license/bsd-2-clause",
  "BSD-3-Clause: https://opensource.org/license/bsd-3-clause",
  "",
);
await writeFile(
  resolve("dist", "bridge", "THIRD-PARTY-LICENSES.txt"),
  notices.join("\n"),
);
