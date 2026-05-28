import { writeFileSync } from "node:fs";
import { APP_UPDATES } from "../src/constants/updates";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const outputPath = process.argv[3];
const version = tag.replace(/^v/, "");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

if (!version) {
  throw new Error("Missing release tag. Usage: generate-release-notes.ts v0.7.5 /path/to/release-notes.md");
}

if (!outputPath) {
  throw new Error("Missing output path. Usage: generate-release-notes.ts v0.7.5 /path/to/release-notes.md");
}

if (!tag.startsWith("v") || !semverPattern.test(version)) {
  throw new Error(`Release tag must be v-prefixed SemVer, for example v0.7.5. Received: ${tag}`);
}

const releasedUpdates = APP_UPDATES.filter((update) => update.category !== "planned");
const updateIndex = releasedUpdates.findIndex((update) => update.version === version);
const update = releasedUpdates[updateIndex];

if (!update) {
  throw new Error(`No APP_UPDATES entry found for ${version}.`);
}

const previous = releasedUpdates[updateIndex + 1];
const fullChangelogLabel = previous ? `v${previous.version}...v${version}` : `v${version}`;
const fullChangelog = previous
  ? `https://github.com/bniladridas/diff/compare/v${previous.version}...v${version}`
  : `https://github.com/bniladridas/diff/commits/v${version}`;

const lines = [
  `## ${update.title}`,
  "",
  update.description,
  "",
  "## Changes",
  "",
  ...update.details.map((detail) => `- ${detail}`),
  "",
  `**Full Changelog**: [${fullChangelogLabel}](${fullChangelog})`,
  ""
];

writeFileSync(outputPath, lines.join("\n"));
