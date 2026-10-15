/**
 * Where a walkthrough and its code come from: a JSON file plus the git checkout it describes.
 * The renderer gets the document, file text at a pinned side, changed lines and the PR patch.
 */
import { basename } from "node:path";
import { homedir } from "node:os";

export type Side = "base" | "head";

export interface FileText { commit: string; text: string }

export interface Source {
  /** Raw document JSON; parsed and validated by the caller. */
  raw: unknown;
  /** Shown in the page's generator meta: the walkthrough file's path. */
  label: string;
  readFile(side: Side, file: string): Promise<FileText>;
  /** Changed line numbers keyed `${side}:${file}`, for the given files. */
  changedLines(files: string[]): Promise<Map<string, Set<number>>>;
  /** The git checkout the document describes. */
  checkout: string;
  /**
   * Head lines GitHub accepts a review comment on, keyed by file: every line of every
   * hunk in the PR diff with GitHub's 3 lines of context.
   */
  hunkLines(files: string[]): Promise<Map<string, Set<number>>>;
  /** Every file path at a side, for resolving `file.ts:12` refs in review comment text. */
  listFiles(side: Side): Promise<string[]>;
  /** Files the PR changes (base → head), for resolving short names like `controller :12`. */
  diffFiles(): Promise<string[]>;
  /** The full base → head patch for the Diff tab, minus paths matching the exclude globs. */
  patch(exclude: string[]): Promise<string>;
}

async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    const message = `${out}\n${err}`
      .split("\n")
      .filter((l) => l.trim() && !/Warning:|trace-warnings/.test(l))
      .join(" ");
    throw new Error(message || `${cmd.slice(0, 3).join(" ")} exited ${code}`);
  }
  return out;
}

function mark(changed: Map<string, Set<number>>, side: Side, file: string, line: number): void {
  const key = `${side}:${file}`;
  let set = changed.get(key);
  if (!set) changed.set(key, (set = new Set()));
  set.add(line);
}

/**
 * A walkthrough written straight to JSON. `pins.base`/`pins.head` may be any git
 * revision; they are resolved to commit SHAs once so every read uses the same commits.
 */
export async function gitSource(jsonPath: string, repo: string | undefined): Promise<Source> {
  const raw = JSON.parse(await Bun.file(jsonPath).text());
  const cwd = repo ?? (await run(["git", "rev-parse", "--show-toplevel"])).trim();
  const git = (...args: string[]) => run(["git", ...args], cwd);
  const pins = raw?.pins as { head?: unknown; base?: unknown } | undefined;
  const commits: Partial<Record<Side, string>> = {};
  for (const side of ["head", "base"] as const) {
    const rev = pins?.[side];
    if (typeof rev !== "string") continue;
    try {
      commits[side] = (await git("rev-parse", "--verify", "--quiet", `${rev}^{commit}`)).trim();
    } catch {
      throw new Error(`pins.${side}: "${rev}" is not a commit in ${cwd}`);
    }
    pins![side] = commits[side];
  }
  return {
    raw,
    label: basename(jsonPath),
    checkout: cwd,
    async readFile(side, file) {
      const commit = commits[side];
      if (!commit) throw new Error(`the document has no pins.${side}`);
      try {
        return { commit, text: await git("show", `${commit}:${file}`) };
      } catch {
        throw new Error(`file does not exist at ${side} ${commit.slice(0, 7)}`);
      }
    },
    async changedLines(files) {
      const changed = new Map<string, Set<number>>();
      if (!files.length || !commits.base || !commits.head) return changed;
      const patch = await git("diff", "--no-color", "--no-ext-diff", "--no-renames", "-U0", commits.base, commits.head, "--", ...files);
      let baseFile = "";
      let headFile = "";
      let baseLine = 0;
      let headLine = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("--- ")) baseFile = line.slice(6);
        else if (line.startsWith("+++ ")) headFile = line.slice(6);
        else if (line.startsWith("@@")) {
          const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
          if (m) [baseLine, headLine] = [Number(m[1]), Number(m[2])];
        } else if (line.startsWith("+")) mark(changed, "head", headFile, headLine++);
        else if (line.startsWith("-")) mark(changed, "base", baseFile, baseLine++);
      }
      return changed;
    },
    async hunkLines(files) {
      const lines = new Map<string, Set<number>>();
      if (!files.length || !commits.base || !commits.head) return lines;
      const patch = await git("diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", commits.base, commits.head, "--", ...files);
      let headFile = "";
      for (const line of patch.split("\n")) {
        if (line.startsWith("+++ ")) headFile = line.slice(6);
        const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!m) continue;
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let n = start; n < start + count; n++) mark(lines, "head", headFile, n);
      }
      return lines;
    },
    async listFiles(side) {
      const commit = commits[side];
      if (!commit) return [];
      return (await git("ls-tree", "-r", "--name-only", commit)).split("\n").filter(Boolean);
    },
    async diffFiles() {
      if (!commits.base || !commits.head) return [];
      return (await git("diff", "--name-only", "--no-renames", commits.base, commits.head)).split("\n").filter(Boolean);
    },
    async patch(exclude) {
      if (!commits.base || !commits.head) throw new Error("the Diff tab needs pins.base");
      const pathspecs = exclude.map((g) => `:(exclude,glob)${g}`);
      return git("diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", commits.base, commits.head, "--", ".", ...pathspecs);
    },
  };
}

// ---------------------------------------------------------------- GitHub

/** "owner/repo" from a checkout's origin remote, if it is on github.com. */
export async function githubSlug(checkout: string): Promise<string | undefined> {
  try {
    const url = (await run(["git", "remote", "get-url", "origin"], checkout)).trim();
    return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  } catch {
    return undefined;
  }
}

export interface PullRequest { url: string; number: number; title?: string; state?: "OPEN" | "CLOSED" | "MERGED"; isDraft?: boolean; body?: string; headRefOid?: string }

/**
 * Look up a PR with gh, by number/URL or by head branch (newest first).
 * Runs from $HOME so a checkout's tool config (e.g. mise.toml) can't break the gh shim.
 */
export async function findPullRequest(slug: string, by: { ref: string } | { branch: string } | { commit: string }): Promise<PullRequest | undefined> {
  const fields = "url,number,title,state,isDraft,body,headRefOid";
  const list = ["gh", "pr", "list", "-R", slug, "--state", "all", "--limit", "1", "--json", fields];
  const cmd =
    "ref" in by
      ? ["gh", "pr", "view", by.ref, "-R", slug, "--json", fields]
      : "branch" in by
        ? [...list, "--head", by.branch]
        : [...list, "--search", by.commit];
  const proc = Bun.spawn(cmd, { cwd: homedir(), stdout: "pipe", stderr: "pipe", timeout: 15_000 });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(err.trim().split("\n")[0] || `gh exited ${code}`);
  const result = JSON.parse(out) as PullRequest | PullRequest[];
  return Array.isArray(result) ? result[0] : result;
}
