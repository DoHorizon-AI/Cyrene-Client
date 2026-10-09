import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: node collect-control-licenses.mjs <repository-root> <release-root>");

const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const packages = [];
const licenseNames = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.txt"];
await mkdir(join(output, "licenses", "npm"), { recursive: true });

for (const [installPath, locked] of Object.entries(lock.packages ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
  if (!installPath.startsWith("node_modules/")) continue;
  if (installPath.split("/").some(segment => segment === ".." || segment === ".")) throw new Error(`Unsafe npm package path in lockfile: ${installPath}`);
  const packageDirectory = join(root, installPath);
  try {
    const directoryInfo = await lstat(packageDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) continue;
  } catch { continue; }
  let manifest;
  try { manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")); }
  catch { continue; }
  const name = typeof manifest.name === "string" ? manifest.name : installPath.slice("node_modules/".length);
  const version = typeof manifest.version === "string" ? manifest.version : String(locked.version ?? "unknown");
  const license = manifest.license ?? manifest.licenses ?? "unspecified";
  let licenseFile;
  for (const candidate of licenseNames) {
    try {
      const info = await lstat(join(packageDirectory, candidate));
      if (info.isFile() && !info.isSymbolicLink() && info.size <= 2 * 1024 * 1024) { licenseFile = candidate; break; }
    } catch { /* A package may declare an SPDX license without shipping a separate text file. */ }
  }
  let archivedLicense;
  if (licenseFile) {
    const key = createHash("sha256").update(`${name}\0${version}`).digest("hex").slice(0, 16);
    archivedLicense = `licenses/npm/${key}-${basename(licenseFile)}`;
    await copyFile(join(packageDirectory, licenseFile), join(output, archivedLicense));
  }
  packages.push({ name, version, license, licenseFile: archivedLicense ?? null });
}

packages.sort((left, right) => `${left.name}\0${left.version}` < `${right.name}\0${right.version}` ? -1 : `${left.name}\0${left.version}` > `${right.name}\0${right.version}` ? 1 : 0);
const lines = [
  "# Third-party notices",
  "",
  "This native Control release contains JavaScript packages installed from the committed package lockfile.",
  "License identifiers and available license texts are listed below. Node.js runtime license is in `runtime/LICENSE`.",
  "",
  `Node.js runtime source: https://nodejs.org/dist/${process.env.NODE_RUNTIME_VERSION ?? "v24.21.0"}/`,
  `Node.js archive SHA-256: ${process.env.NODE_RUNTIME_SHA256 ?? "pinned by the release workflow"}`,
  "",
  "| Package | Version | License | License text |",
  "| --- | --- | --- | --- |",
  ...packages.map(item => {
    const license = typeof item.license === "string" ? item.license : JSON.stringify(item.license);
    const file = item.licenseFile ? `\`${item.licenseFile}\`` : "Not shipped separately";
    return `| ${item.name.replaceAll("|", "\\|")} | ${item.version.replaceAll("|", "\\|")} | ${license.replaceAll("|", "\\|")} | ${file} |`;
  }),
  "",
];
await writeFile(join(output, "licenses", "THIRD_PARTY_NOTICES.md"), lines.join("\n"), { flag: "wx", mode: 0o644 });
process.stdout.write(`Recorded license metadata for ${packages.length} locked npm packages.\n`);
