// scripts/sync-ghost-docs.mjs
import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const upstreamRepo = process.env.UPSTREAM_REPO || "TryGhost/Docs";
const upstreamPath = process.env.UPSTREAM_PATH || "themes";
const targetDir = process.env.TARGET_DIR || "docs";
const upstreamRef = process.env.UPSTREAM_REF || "main";

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

async function listDir(owner, repo, dirPath, ref) {
  const url = `${apiBase}/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`;
  return gh(url);
}

async function resolveCommit(owner, repo, ref) {
  const commit = await gh(`${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
  return commit.sha;
}

async function downloadFile(owner, repo, commit, filePath) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${filePath}`;
  const res = await fetch(url, {
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

async function walk(owner, repo, dirPath, outRoot, ref, commit) {
  const items = await listDir(owner, repo, dirPath, ref);

  if (!Array.isArray(items)) return;

  for (const item of items) {
    const rel = item.path;
    const outPath = path.join(outRoot, rel.slice(upstreamPath.length + 1));

    if (item.type === "dir") {
      await walk(owner, repo, item.path, outRoot, ref, commit);
      continue;
    }

    console.log(`Downloading ${item.path} to ${outPath}`);
    const content = await downloadFile(owner, repo, commit, item.path);
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

  const commit = await resolveCommit(owner, repo, upstreamRef);
  const targetPath = path.resolve(targetDir);
  const parentDir = path.dirname(targetPath);
  const tempDir = await fs.mkdtemp(path.join(parentDir, ".ghost-docs-"));
  const backupDir = `${targetPath}.previous`;

  try {
    await walk(owner, repo, upstreamPath, tempDir, upstreamRef, commit);
    await fs.writeFile(path.join(tempDir, ".source.json"), `${JSON.stringify({
      upstream_repo: upstreamRepo,
      upstream_path: upstreamPath,
      upstream_ref: upstreamRef,
      upstream_commit: commit,
      synced_at: new Date().toISOString(),
    }, null, 2)}\n`);

    await fs.rm(backupDir, { recursive: true, force: true });
    try {
      await fs.rename(targetPath, backupDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(tempDir, targetPath);
    } catch (error) {
      await fs.rename(backupDir, targetPath).catch(() => {});
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
