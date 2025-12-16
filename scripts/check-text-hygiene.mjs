#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOTS = ["docs", "scripts"];
const DEFAULT_EXTENSIONS = [
  ".md",
  ".mjs",
  ".cjs",
  ".js",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".env",
  ".sh",
  ".ps1",
  ".txt",
];

const CONTROL_BYTE_ALLOWLIST = new Set([0x09, 0x0a, 0x0d]); // tab, lf, cr

const parseArgs = () => {
  const args = process.argv.slice(2);
  const roots = [];
  const extensions = [];
  let enforceAscii = false;
  let failOnNonUtf8 = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      roots.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--ext" && args[i + 1]) {
      extensions.push(args[i + 1].startsWith(".") ? args[i + 1] : `.${args[i + 1]}`);
      i += 1;
      continue;
    }
    if (arg === "--enforce-ascii") {
      enforceAscii = true;
      continue;
    }
    if (arg === "--no-utf8") {
      failOnNonUtf8 = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
  }

  return {
    help: false,
    roots: roots.length > 0 ? roots : DEFAULT_ROOTS,
    extensions: extensions.length > 0 ? extensions : DEFAULT_EXTENSIONS,
    enforceAscii,
    failOnNonUtf8,
  };
};

const usage = () => {
  console.log(
    [
      "Usage: node scripts/check-text-hygiene.mjs [options]",
      "",
      "Options:",
      "  --root <dir>          Root directory to scan (repeatable). Default: docs, scripts",
      "  --ext <ext>           File extension to include (repeatable). Default: common text extensions",
      "  --enforce-ascii       Fail if any scanned file contains non-ASCII characters",
      "  --no-utf8             Skip UTF-8 decoding check (still checks for control bytes)",
      "  -h, --help            Show this help",
      "",
      "Checks:",
      "  - No ASCII control bytes (except tab/newline/CR) and no DEL (0x7F).",
      "  - (Default) Files must be valid UTF-8.",
    ].join("\n"),
  );
};

const isControlByte = (byte) =>
  (byte < 0x20 && !CONTROL_BYTE_ALLOWLIST.has(byte)) || byte === 0x7f;

const shouldScanPath = (filePath, extensions) =>
  extensions.includes(path.extname(filePath).toLowerCase());

const walk = async (rootDir, extensions) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && shouldScanPath(entryPath, extensions)) {
        files.push(entryPath);
      }
    }
  }

  return files;
};

const findFirstControlByte = (buffer) => {
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (isControlByte(byte)) return { index: i, byte };
  }
  return null;
};

const buildLineMap = (buffer) => {
  const lineStarts = [0];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) lineStarts.push(i + 1);
  }
  return lineStarts;
};

const byteOffsetToLineCol = (buffer, lineStarts, byteOffset) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : buffer.length + 1;
    if (byteOffset < start) high = mid - 1;
    else if (byteOffset >= next) low = mid + 1;
    else return { line: mid + 1, col: byteOffset - start + 1 };
  }
  return { line: 1, col: byteOffset + 1 };
};

const isUtf8 = (buffer) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

const hasNonAscii = (buffer) => buffer.some((byte) => byte >= 0x80);

const main = async () => {
  const options = parseArgs();
  if (options.help) {
    usage();
    process.exit(0);
  }

  const repoRoot = process.cwd();
  const roots = options.roots.map((root) => path.resolve(repoRoot, root));
  const extensions = options.extensions.map((ext) => ext.toLowerCase());

  const allFiles = [];
  for (const root of roots) {
    // eslint-disable-next-line no-await-in-loop
    const files = await walk(root, extensions);
    allFiles.push(...files);
  }

  const issues = [];

  for (const absolutePath of allFiles) {
    // eslint-disable-next-line no-await-in-loop
    const buffer = await fs.readFile(absolutePath);
    const relativePath = path.relative(repoRoot, absolutePath);

    const control = findFirstControlByte(buffer);
    if (control) {
      const lineStarts = buildLineMap(buffer);
      const { line, col } = byteOffsetToLineCol(buffer, lineStarts, control.index);
      issues.push(
        `${relativePath}:${line}:${col} contains control byte 0x${control.byte.toString(16).padStart(2, "0").toUpperCase()}`,
      );
      continue;
    }

    if (options.failOnNonUtf8 && !isUtf8(buffer)) {
      issues.push(`${relativePath} is not valid UTF-8`);
      continue;
    }

    if (options.enforceAscii && hasNonAscii(buffer)) {
      issues.push(`${relativePath} contains non-ASCII bytes`);
    }
  }

  if (issues.length > 0) {
    console.error(`[text-hygiene] Found ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`[text-hygiene] OK (${allFiles.length} file(s) scanned)`);
};

await main();
