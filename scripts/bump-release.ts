import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";

type ReleaseCategory = "feature" | "improvement" | "fix";

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const usage = `Usage:
  npm run bump:release -- patch --title "Release Title" --description "Short release description." --category fix --detail "First change"
  npm run bump:release -- X.Y.Z --title "Release Title" --description "Short release description." --category fix --detail "First change"

Options:
  patch | minor | major | X.Y.Z  Target release version.
  --title <text>                 In-app update and release-note title.
  --description <text>           Short in-app update and release-note description.
  --category <type>              feature, improvement, or fix.
  --detail <text>                Repeat for each release-note bullet.
  --dry-run                      Print the planned bump without writing files.
`;

const args = process.argv.slice(2);
const optionsWithValues = new Set(["--title", "--description", "--category", "--detail"]);
const positionalArgs: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (optionsWithValues.has(arg)) {
    index++;
    continue;
  }
  if (!arg.startsWith("--")) {
    positionalArgs.push(arg);
  }
}
const targetArg = positionalArgs[0];
const dryRun = args.includes("--dry-run");

function readOption(name: string) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return "";
  return args[index + 1] ?? "";
}

function readRepeatedOption(name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === `--${name}` && args[index + 1]) {
      values.push(args[index + 1]);
      index++;
    }
  }
  return values;
}

function parseVersion(version: string) {
  if (!semverPattern.test(version)) {
    throw new Error(`Version must be SemVer in X.Y.Z form. Received: ${version}`);
  }

  const [major, minor, patch] = version.split(".").map((part) => Number(part));
  return { major, minor, patch };
}

function bumpVersion(current: string, target: string) {
  const parsed = parseVersion(current);
  if (target === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (target === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (target === "major") return `${parsed.major + 1}.0.0`;
  parseVersion(target);
  return target;
}

function readJson<T>(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertWritable(paths: string[]) {
  const blocked = paths.filter((path) => {
    try {
      accessSync(path, constants.W_OK);
      return false;
    } catch {
      return true;
    }
  });

  if (blocked.length > 0) {
    throw new Error(`Cannot write release files:\n${blocked.map((path) => `- ${path}`).join("\n")}`);
  }
}

function updatePackageLock(version: string) {
  const lock = readJson<{
    version?: string;
    packages?: Record<string, { version?: string }>;
  }>("package-lock.json");

  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }

  writeJson("package-lock.json", lock);
}

function updateAppUpdates(
  version: string,
  title: string,
  description: string,
  category: ReleaseCategory,
  details: string[],
) {
  const path = "src/constants/updates.ts";
  const current = readFileSync(path, "utf8");

  if (current.includes(`version: "${version}"`)) {
    throw new Error(`src/constants/updates.ts already has an entry for ${version}.`);
  }

  const detailLines = details
    .map((detail) => `      ${JSON.stringify(detail)}`)
    .join(",\n");
  const entry = `  {
    version: ${JSON.stringify(version)},
    title: ${JSON.stringify(title)},
    description: ${JSON.stringify(description)},
    category: ${JSON.stringify(category)},
    details: [
${detailLines}
    ]
  },
`;

  const marker = "export const APP_UPDATES: AppUpdate[] = [\n";
  if (!current.includes(marker)) {
    throw new Error(`Could not find APP_UPDATES marker in ${path}.`);
  }

  writeFileSync(path, current.replace(marker, `${marker}${entry}`));
}

function updateCodexReadme(previousVersion: string, version: string, title: string) {
  const path = ".codex/README.md";
  let current = readFileSync(path, "utf8");
  const today = new Date().toISOString().slice(0, 10);

  current = current.replace(/^Last updated: .+$/m, `Last updated: ${today}`);
  current = current.replace(
    "Release line:\n\n",
    `Release line:\n\n- \`v${version}\` ${title}\n`,
  );
  current = current.replace(
    /Release tags use `v`-prefixed SemVer\. Example: tag `v[^`]+`, version `[^`]+`\./,
    `Release tags use \`v\`-prefixed SemVer. Example: tag \`v${version}\`, version \`${version}\`.`,
  );
  current = current.replace(
    /Each stable tag needs a matching release branch at the same commit\. Example: `release\/[^`]+` points at `v[^`]+`\./,
    `Each stable tag needs a matching release branch at the same commit. Example: \`release/${version}\` points at \`v${version}\`.`,
  );
  current = current.replace(
    /^The current .+ release is part of `v.+`\.$/m,
    `The current ${title.toLowerCase()} release is part of \`v${version}\`.`,
  );

  writeFileSync(path, current);
}

function updateExamples(previousVersion: string, version: string) {
  for (const path of ["scripts/generate-release-notes.ts", "docs/workflows.md"]) {
    const current = readFileSync(path, "utf8");
    writeFileSync(path, current.replaceAll(`v${previousVersion}`, `v${version}`));
  }
}

if (!targetArg || args.includes("--help")) {
  console.log(usage);
  process.exit(args.includes("--help") ? 0 : 1);
}

const packageJson = readJson<{ version: string }>("package.json");
const previousVersion = packageJson.version;
const version = bumpVersion(previousVersion, targetArg);
const title = readOption("title").trim();
const description = readOption("description").trim();
const category = readOption("category").trim() as ReleaseCategory;
const details = readRepeatedOption("detail").map((detail) => detail.trim()).filter(Boolean);

if (version === previousVersion) {
  throw new Error(`Target version is already current: ${version}`);
}

if (!title || !description || !category || details.length === 0) {
  throw new Error(`Release title, description, category, and at least one detail are required.\n\n${usage}`);
}

if (!["feature", "improvement", "fix"].includes(category)) {
  throw new Error(`Release category must be feature, improvement, or fix. Received: ${category}`);
}

const plan = [
  `Bump ${previousVersion} -> ${version}`,
  "Update package.json",
  "Update package-lock.json",
  "Update VERSION",
  "Add src/constants/updates.ts release entry",
  "Update .codex/README.md release line and examples",
  "Update release-note and workflow examples",
];

if (dryRun) {
  console.log(plan.join("\n"));
  process.exit(0);
}

assertWritable([
  "package.json",
  "package-lock.json",
  "VERSION",
  "src/constants/updates.ts",
  ".codex/README.md",
  "scripts/generate-release-notes.ts",
  "docs/workflows.md",
]);

packageJson.version = version;
writeJson("package.json", packageJson);
updatePackageLock(version);
writeFileSync("VERSION", `${version}\n`);
updateAppUpdates(version, title, description, category, details);
updateCodexReadme(previousVersion, version, title);
updateExamples(previousVersion, version);

console.log(plan.join("\n"));
console.log(`\nNext: node --import tsx ./scripts/generate-release-notes.ts v${version} /tmp/diff-release-notes.md`);
