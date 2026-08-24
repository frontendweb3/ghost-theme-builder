// scripts/sync-ghost-docs.mjs
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initSync, convert } from "@icyjoseph/mdx2md";

const token = process.env.GITHUB_TOKEN;
const upstreamRepo = process.env.UPSTREAM_REPO || "TryGhost/Docs";
const upstreamPath = process.env.UPSTREAM_PATH || "themes";
const targetDir = process.env.TARGET_DIR || "docs";
const upstreamRef = process.env.UPSTREAM_REF || "main";

console.log(`Syncing Ghost docs from ${upstreamRepo}:${upstreamRef}/${upstreamPath} to ${targetDir}`);
console.log(`Target dir: ${targetDir}`);

const apiBase = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ghost-theme-builder-sync",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const MIN_REQUEST_INTERVAL_MS = 1_000;
let lastRequestTime = 0;

async function rateLimitWait(res) {
  const remaining = Number(res.headers.get("X-RateLimit-Remaining"));
  const reset = Number(res.headers.get("X-RateLimit-Reset"));
  const limit = Number(res.headers.get("X-RateLimit-Limit"));

  if (remaining === 0 && reset) {
    const waitMs = Math.max(0, reset * 1000 - Date.now() + 1000);
    console.log(`Rate limit exhausted (${limit}/${limit}). Waiting ${Math.ceil(waitMs / 1000)}s until reset.`);
    await new Promise((r) => setTimeout(r, waitMs));
    return;
  }

  if (remaining <= 10 && reset) {
    const waitMs = Math.max(0, reset * 1000 - Date.now() + 1000);
    console.log(`Rate limit low (${remaining}/${limit} remaining). Waiting ${Math.ceil(waitMs / 1000)}s until reset.`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function politeDelay() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    return new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
}

async function gh(url) {
  await politeDelay();
  const res = await fetch(url, { headers });
  lastRequestTime = Date.now();

  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    await rateLimitWait(res);
    return gh(url);
  }

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);

  await rateLimitWait(res);
  return res.json();
}

async function listDir(owner, repo, dirPath, ref) {
  return gh(`${apiBase}/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`);
}

async function resolveCommit(owner, repo, dirPath, ref) {
  const url = `${apiBase}/repos/${owner}/${repo}/commits?path=${encodeURIComponent(dirPath)}&sha=${encodeURIComponent(ref)}&per_page=1`;
  const res = await gh(url);
  if (Array.isArray(res) && res.length > 0) {
    return res[0].sha;
  }
  return (await gh(`${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`)).sha;
}

async function downloadFile(owner, repo, commit, filePath) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${filePath}`;
  const res = await fetch(url, {
    headers: { ...headers, Accept: "application/vnd.github.raw" },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${await res.text()}`);
  return res.text();
}

function callout(label) {
  return (props) => `> **${label}:** ${props.children ?? ""}`;
}

function note(props) {
  return `> ${props.children ?? ""}`;
}

function frame(props) {
  const caption = props.caption ? `\n\n*${props.caption}*` : "";
  return `${props.children ?? ""}${caption}`;
}

function card(props) {
  let output = props.children ?? "";
  if (!props.title) return output;

  const title = props.href
    ? `[**${props.title}**](${props.href})`
    : `**${props.title}**`;

  return `${title}\n\n${output}`;
}

function cardGroup(props) {
  return props.children ?? "";
}

async function walk(owner, repo, dirPath, outRoot, ref, commit) {
  const items = await listDir(owner, repo, dirPath, ref);
  if (!Array.isArray(items)) return;

  for (const item of items) {
    const rel = item.path;
    const localPath = rel.slice(upstreamPath.length + 1).replace(/\.mdx$/, ".md");
    const outPath = path.join(outRoot, localPath);

    if (item.type === "dir") {
      await walk(owner, repo, item.path, outRoot, ref, commit);
      continue;
    }

    console.log(`Downloading ${item.path} to ${outPath}`);
    const content = await downloadFile(owner, repo, commit, item.path);
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    if (path.extname(item.path) === ".mdx") {
      const markdown = convert(content, {
        stripImports: true,
        stripExports: true,
        preserveFrontmatter: true,
        expressionHandling: "preserve",
        components: {
          Card: card,
          CardGroup: cardGroup,
          Frame: frame,
          Info: callout("Info"),
          Note: note,
          Tip: callout("Tip"),
          Warning: callout("Warning"),
          _default: (props) => props.children ?? "",
        },
        markdown: {
          tables: "list",
        },
      });
      await fs.writeFile(outPath, markdown, "utf8");
    } else {
      await fs.writeFile(outPath, content, "utf8");
    }

    console.log(`Updated ${outPath}`);
  }
}

async function main() {
  const [owner, repo] = upstreamRepo.split("/");
  if (!owner || !repo) throw new Error(`Invalid UPSTREAM_REPO: ${upstreamRepo}`);

  const targetPath = path.resolve(targetDir);
  const commit = await resolveCommit(owner, repo, upstreamPath, upstreamRef);

  let existingMeta = null;
  try {
    const metaContent = await fs.readFile(path.join(targetPath, ".source.json"), "utf8");
    existingMeta = JSON.parse(metaContent);
  } catch {
    // Existing metadata not found or invalid
  }

  if (!process.env.FORCE_SYNC && existingMeta && existingMeta.upstream_commit === commit) {
    console.log(`No changes upstream in ${upstreamRepo} (${commit}). Skipping sync.`);
    return;
  }

  const wasmPath = new URL("../node_modules/@icyjoseph/mdx2md/mdx2md_wasm_bg.wasm", import.meta.url);
  initSync({ module: readFileSync(wasmPath) });

  const parentDir = path.dirname(targetPath);
  const tempDir = await fs.mkdtemp(path.join(parentDir, ".ghost-docs-"));
  const backupDir = `${targetPath}.previous`;

  try {
    await walk(owner, repo, upstreamPath, tempDir, upstreamRef, commit);
    await fs.writeFile(
      path.join(tempDir, ".source.json"),
      `${JSON.stringify({
        upstream_repo: upstreamRepo,
        upstream_path: upstreamPath,
        upstream_ref: upstreamRef,
        upstream_commit: commit,
        synced_at: new Date().toISOString(),
      }, null, 2)}\n`,
    );

    await fs.rm(backupDir, { recursive: true, force: true });
    try {
      await fs.rename(targetPath, backupDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(tempDir, targetPath);
    } catch (error) {
      await fs.rename(backupDir, targetPath).catch(() => { });
      throw error;
    }

    await fs.rm(backupDir, { recursive: true, force: true });
    console.log(`Sync complete at ${commit}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
