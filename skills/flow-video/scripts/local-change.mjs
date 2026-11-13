#!/usr/bin/env node
// Turn a local git change into the capture/pr.json + capture/diff.patch that
// pr-to-video's ingest.mjs reads, and print the project dir for it.
//
// Usage:
//   node local-change.mjs [--source <uncommitted | SHA | A..B>] [--out-dir ./capture]
//   node local-change.mjs [--source ...] --project-dir-only
//   node local-change.mjs --self-test
//
// No --source: uncommitted if the tree is dirty, else merge-base(default branch)..HEAD.
// Run from inside the repo whose change you are explaining.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const gitTry = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch (e) {
    return (e.stdout || "").toString(); // `diff --no-index` exits 1 when files differ
  }
};

function defaultBranch(cwd) {
  const ref = gitTry(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd).trim();
  if (ref) return ref.replace("refs/remotes/", "");
  for (const b of ["main", "master"]) {
    if (gitTry(["rev-parse", "--verify", "--quiet", b], cwd).trim()) return b;
  }
  throw new Error("cannot find a default branch; pass --source");
}

// → { kind, from, to, label }   to = null means the working tree
export function resolveSource(source, cwd) {
  if (!source) {
    const dirty = git(["status", "--porcelain"], cwd).trim();
    if (dirty) source = "uncommitted";
    else {
      const base = git(["merge-base", defaultBranch(cwd), "HEAD"], cwd).trim();
      source = `${base}..HEAD`;
    }
  }
  const sha = (r) => git(["rev-parse", "--verify", `${r}^{commit}`], cwd).trim();
  if (source === "uncommitted") return { kind: "uncommitted", from: sha("HEAD"), to: null };
  if (source.includes("..")) {
    const [a, b] = source.split(/\.{2,3}/);
    return { kind: "range", from: sha(a), to: sha(b || "HEAD") };
  }
  const to = sha(source);
  const parent = gitTry(["rev-parse", "--verify", "--quiet", `${to}^`], cwd).trim();
  // Root commit: diff against the empty tree.
  return { kind: "commit", from: parent || "4b825dc642cb6eb9a060e54bf8d69288fbee4904", to };
}

function diffOf(src, cwd) {
  if (src.to) return git(["diff", src.from, src.to], cwd);
  let diff = git(["diff", "HEAD"], cwd);
  // Untracked files are part of the change but invisible to `git diff HEAD`.
  for (const f of git(["ls-files", "--others", "--exclude-standard"], cwd).split("\n").filter(Boolean)) {
    diff += gitTry(["diff", "--no-index", "--", "/dev/null", f], cwd);
  }
  return diff;
}

function filesOf(diff) {
  const files = [];
  let cur = null;
  for (const line of diff.split("\n")) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      cur = { path: m[2], additions: 0, deletions: 0, status: "modified" };
      files.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("new file")) cur.status = "added";
    else if (line.startsWith("deleted file")) cur.status = "removed";
    else if (line.startsWith("+") && !line.startsWith("+++")) cur.additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) cur.deletions++;
  }
  return files;
}

function commitsOf(src, cwd) {
  if (!src.to) return [];
  const range = src.kind === "commit" ? ["-1", src.to] : [`${src.from}..${src.to}`];
  const out = git(["log", "--reverse", "--format=%H%x1f%an%x1f%ae%x1f%s%x1f%b%x1e", ...range], cwd);
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [oid, name, email, subject, body] = r.split("\x1f");
      // login stays null: ingest only credits people with a GitHub login. SKILL.md
      // fills it via `gh api` when the repo is on GitHub.
      return { oid, messageHeadline: subject, messageBody: body || "", authors: [{ login: null, name, email }] };
    });
}

function repoId(cwd) {
  const url = gitTry(["remote", "get-url", "origin"], cwd).trim();
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  const top = git(["rev-parse", "--show-toplevel"], cwd).trim();
  return m ? { owner: m[1], repo: m[2] } : { owner: "local", repo: basename(top) };
}

const seg = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Mirrors pr-to-video's project-dir.mjs cache layout.
export function projectDir(src, diff, cwd, env = process.env) {
  const { owner, repo } = repoId(cwd);
  const suffix =
    src.kind === "uncommitted"
      ? `wip-${createHash("sha1").update(diff).digest("hex").slice(0, 8)}`
      : src.kind === "commit"
        ? src.to.slice(0, 7)
        : `${src.from.slice(0, 7)}-${src.to.slice(0, 7)}`;
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
  return join(cache, "hyperframes", "pr-to-video", seg(owner), seg(repo), `${seg(repo)}-${suffix}`);
}

export function build(source, cwd) {
  const src = resolveSource(source, cwd);
  const diff = diffOf(src, cwd);
  const files = filesOf(diff);
  const commits = commitsOf(src, cwd);
  const branch = gitTry(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim() || "HEAD";
  const pr = {
    number: null,
    // The agent replaces title/body with ones written from the diff (SKILL.md step 1).
    title: commits.length === 1 ? commits[0].messageHeadline : `${src.kind} change on ${branch}`,
    body: commits.map((c) => `- ${c.messageHeadline}`).join("\n"),
    author: { login: null, name: git(["config", "user.name"], cwd).trim() || null },
    url: "",
    headRepository: { nameWithOwner: `${repoId(cwd).owner}/${repoId(cwd).repo}` },
    baseRefName: src.from.slice(0, 7),
    headRefName: src.to ? src.to.slice(0, 7) : "working tree",
    commits,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changedFiles: files.length,
    labels: [],
    reviews: [],
    latestReviews: [],
    comments: [],
    assignees: [],
    state: "LOCAL",
    shipped_version: null,
    version_source: null,
  };
  return { src, diff, pr, dir: projectDir(src, diff, cwd) };
}

function selfTest() {
  const repo = mkdtempSync(join(tmpdir(), "flow-video-"));
  try {
    const g = (...a) => git(["-c", "user.name=T", "-c", "user.email=t@t", ...a], repo);
    g("init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "one\n");
    g("add", ".");
    g("commit", "-qm", "first");
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    g("commit", "-qam", "second");
    const c = build("HEAD", repo);
    assert(c.src.kind === "commit" && c.pr.title === "second", "commit title");
    assert(c.pr.additions === 1 && c.pr.files[0].path === "a.txt", "commit stats");
    const r = build("HEAD~1..HEAD", repo);
    assert(r.src.kind === "range" && r.pr.commits.length === 1, "range commits");
    writeFileSync(join(repo, "new.txt"), "x\ny\n");
    const u = build(undefined, repo);
    assert(u.src.kind === "uncommitted", "dirty tree defaults to uncommitted");
    assert(u.pr.files.some((f) => f.path === "new.txt" && f.status === "added" && f.additions === 2), "untracked included");
    assert(/-wip-[0-9a-f]{8}$/.test(u.dir), "wip project dir");
    console.log("✓ local-change self-test passed");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function assert(ok, msg) {
  if (!ok) {
    console.error(`✗ self-test: ${msg}`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (resolve(process.argv[1] || "") === resolve(new URL(import.meta.url).pathname)) {
  if (argv.includes("--self-test")) selfTest();
  else {
    try {
      const { src, diff, pr, dir } = build(flag("source"), process.cwd());
      if (argv.includes("--project-dir-only")) {
        console.log(dir);
      } else {
        const out = resolve(flag("out-dir") || "./capture");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "pr.json"), JSON.stringify(pr, null, 2) + "\n");
        writeFileSync(join(out, "diff.patch"), diff);
        console.log(
          `✓ local-change: ${src.kind} — ${pr.changedFiles} files, +${pr.additions}/−${pr.deletions}, ${pr.commits.length} commits → ${out}`,
        );
      }
    } catch (e) {
      console.error(`✗ local-change: ${e.message}`);
      process.exit(1);
    }
  }
}
