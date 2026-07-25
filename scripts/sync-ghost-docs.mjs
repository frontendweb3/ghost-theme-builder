// scripts/sync-ghost-docs.mjs
import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const upstreamRepo = process.env.UPSTREAM_REPO || "TryGhost/Docs";
const upstreamPath = process.env.UPSTREAM_PATH || "themes";
const targetDir = process.env.TARGET_DIR || "docs";

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const apiBase = "https://api.github.com";

async function gh(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ghost-theme-builder-sync",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function listDir(owner, repo, dirPath, ref = "main") {
  const url = `${apiBase}/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`;
  return gh(url);
}

async function downloadFile(downloadUrl) {
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "ghost-theme-builder-sync",
    },
  });

  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${await res.text()}`);
  }

  return res.text();
}

async function walk(owner, repo, dirPath, outRoot, ref = "main") {
  const items = await listDir(owner, repo, dirPath, ref);

  if (!Array.isArray(items)) return;

  for (const item of items) {
    const rel = item.path;
    const outPath = path.join(outRoot, rel.slice(upstreamPath.length + 1));

    if (item.type === "dir") {
      await walk(owner, repo, item.path, outRoot, ref);
      continue;
    }

    if (!item.download_url) continue;
    console.log(`Downloading ${item.path} to ${outPath}`);
    const content = await downloadFile(item.download_url);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, content, "utf8");
    console.log(`Updated ${outPath}`);
  }
}

async function main() {
  const [owner, repo] = upstreamRepo.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid UPSTREAM_REPO: ${upstreamRepo}`);
  }

  await fs.mkdir(targetDir, { recursive: true });
  await walk(owner, repo, upstreamPath, targetDir, "main");
  console.log("Sync complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});