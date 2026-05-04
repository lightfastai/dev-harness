#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
	cwd: packageRoot,
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
	process.stderr.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exit(result.status ?? 1);
}

const [pack] = JSON.parse(result.stdout);
const files = new Map(pack.files.map((file) => [file.path, file]));
const requiredFiles = [
	"README.md",
	"bin/lightfast-dev.mjs",
	"dist/public.js",
	"dist/public.d.ts",
	"dist/cli.js",
	"dist/main.js",
	"package.json",
];
const forbiddenPrefixes = ["src/", "test/", ".turbo/", "node_modules/"];
const forbiddenFiles = [
	"tsconfig.json",
	"tsconfig.build.json",
	"tsconfig.test.json",
];

const errors = [];

if (packageJson.private === true) {
	errors.push("package.json must not be private for npm publishing.");
}

if (!packageJson.publishConfig || packageJson.publishConfig.access !== "public") {
	errors.push('publishConfig.access must be "public" for this scoped package.');
}

for (const file of requiredFiles) {
	if (!files.has(file)) {
		errors.push(`Missing required packed file: ${file}`);
	}
}

for (const file of files.keys()) {
	if (forbiddenFiles.includes(file)) {
		errors.push(`Unexpected source/config file in package: ${file}`);
	}

	if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
		errors.push(`Unexpected development file in package: ${file}`);
	}
}

for (const target of collectPackageTargets(packageJson)) {
	if (!files.has(target)) {
		errors.push(`package.json references a file outside the package tarball: ${target}`);
	}
}

const binPath = normalizePackagePath(packageJson.bin?.["lightfast-dev"]);
const binFile = files.get(binPath);
if (!binFile) {
	errors.push("Missing lightfast-dev bin in package tarball.");
} else if ((binFile.mode & 0o111) === 0) {
	errors.push("lightfast-dev bin is not executable in package tarball.");
}

if (errors.length) {
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log(
	`npm pack dry-run ok: ${pack.entryCount} files, ${formatBytes(pack.size)} tarball`,
);

function collectPackageTargets(pkg) {
	const targets = new Set();

	for (const value of [pkg.main, pkg.types]) {
		addTarget(targets, value);
	}

	for (const value of Object.values(pkg.bin ?? {})) {
		addTarget(targets, value);
	}

	collectExportTargets(targets, pkg.exports);
	return targets;
}

function collectExportTargets(targets, value) {
	if (typeof value === "string") {
		addTarget(targets, value);
		return;
	}

	if (!value || typeof value !== "object") {
		return;
	}

	for (const nested of Object.values(value)) {
		collectExportTargets(targets, nested);
	}
}

function addTarget(targets, value) {
	const normalized = normalizePackagePath(value);
	if (normalized) {
		targets.add(normalized);
	}
}

function normalizePackagePath(value) {
	if (typeof value !== "string" || path.isAbsolute(value) || value.startsWith("../")) {
		return undefined;
	}

	return value.startsWith("./") ? value.slice(2) : value;
}

function formatBytes(value) {
	if (value < 1024) {
		return `${value} B`;
	}

	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} kB`;
	}

	return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
