#!/usr/bin/env bun
/**
 * diffdeck: render a walkthrough JSON file to one self-contained HTML page, reading code with git
 * from the checkout it describes. Only `gh` PR lookups leave this machine. The output embeds code
 * excerpts, so treat the HTML as being as private as the code itself.
 */
import { parseArgs } from "node:util";
import { basename, dirname, join } from "node:path";
import { Marked, type Tokens } from "marked";
import hljs from "highlight.js";
import * as dagre from "@dagrejs/dagre";
import { GITHUB_PR_URL, parseWalkthrough, type Block, type ColleagueReview, type ReviewItem, type SourceRange } from "./schema.ts";
import { findPullRequest, githubSlug, gitSource, type PullRequest, type Side, type Source } from "./sources.ts";
import { lineRefs, renderReview, renderSelfReview, reviewPayload, type LineRef } from "./review.ts";
import { parsePatch, renderDiff, renderFiles, type DiffFile } from "./diff.ts";
import { loadTheme } from "./theme.ts";

type BlockOf<T extends Block["type"]> = Extract<Block, { type: T }>;
interface Ref { id: string; side: Side; file: string; from: number; to: number }
// dagre fills in points and the label position; the label and style are what we set.
interface LaidOutEdge { points: { x: number; y: number }[]; x: number; y: number; width: number; label?: string; style?: string }

const USAGE = `usage: diffdeck <walkthrough.json> [--repo <checkout>] [--pr <url|number>] [--theme <dir>] [-o out.html] [--open] [--payload | --serve]

Renders the walkthrough, reading code with git from --repo (default: the current checkout).
The PR comes from --pr, then the document's pr.url, then gh (by branch, then by head commit).
Default output: <walkthrough>.html next to the .json.
--theme <dir> uses <dir>/theme.css. Default: ~/.config/diffdeck/theme/theme.css if it exists,
else the built-in theme.
--payload validates the document's review and writes post-payload-<head sha8>.json (the body of
POST /repos/{o}/{r}/pulls/{n}/reviews) next to the .json instead of the page. It never posts.
--serve also serves the page on 127.0.0.1 and waits. When the user presses "Send to agent" in the
Respond sheet, it prints the response to stdout and exits. Run it as a background job.`;
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: "string", short: "o" },
    open: { type: "boolean" },
    repo: { type: "string" },
    pr: { type: "string" },
    theme: { type: "string" },
    payload: { type: "boolean" },
    serve: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});
const input = positionals[0];
if (values.help || positionals.length !== 1 || !input?.endsWith(".json")) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 2);
}

const fail = (lines: string[], hint: string): never => {
  console.error(lines.map((l) => `  ${l}`).join("\n") + `\n${hint}`);
  process.exit(1);
};

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

let source: Source;
try {
  source = await gitSource(input, values.repo);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const parsed = parseWalkthrough(source.raw);
const doc = (parsed.problems.length ? undefined : parsed.doc) ?? fail(parsed.problems, `${parsed.problems.length} problem(s) in the walkthrough; nothing written.`);
const theme = await loadTheme(values.theme);
if (theme.problems.length) fail(theme.problems, `The theme at ${theme.path} can't be used; nothing written.`);
const pins = doc.pins;
const review = doc.review;
// Colleague comments and code findings share one shape for anchors, refs and cards. PR-body findings
// have no code anchor and are checked against the PR description instead.
const items: ReviewItem[] = !review
  ? []
  : review.kind === "colleague"
    ? review.comments
    : review.findings.flatMap((f) => (f.target === "code" ? [{ ...f, path: f.path!, line: f.line! }] : []));
const itemsKey = review?.kind === "self" ? "findings" : "comments";
if (values.payload && review?.kind !== "colleague")
  fail(["--payload"], review ? "A self-review is never posted; --payload is for colleague reviews only." : "The document has no review.");
if (values.payload && review?.kind === "colleague" && review.posted)
  fail(["--payload", `review.posted: review ${review.posted.review_id} is already live`], "Refusing to build a second payload for a posted review. Start a new round without review.posted if you mean to post again.");
if (values.serve && values.payload) fail(["--serve --payload"], "Pick one: --payload writes the post body, --serve waits for the user's response.");
if (values.serve && (!review || (review.kind === "colleague" && review.posted)))
  fail(["--serve"], review ? "This review is already posted, so its page has nothing to send." : "--serve needs a review: it sends back the Respond sheet.");
// The cards show code at pins.head, so a posted record must be pinned to the same commit.
if (review?.kind === "colleague" && review.posted && review.posted.commit_id !== pins.head)
  fail([`review.posted.commit_id ${review.posted.commit_id.slice(0, 7)} ≠ pins.head ${pins.head.slice(0, 7)}`], "Pin the document to the commit the review was posted at.");
const slices: BlockOf<"diff">[] = [];

// ---------------------------------------------------------------- pull request and repository

// Bare #123 mentions resolve against: document.repository, then the PR's repo, then the checkout's origin.
const prArg = values.pr ?? doc.pr?.url;
const prUrlRepo = prArg ? GITHUB_PR_URL.exec(prArg)?.[1] : undefined;
const repository = doc.repository ?? prUrlRepo ?? (await githubSlug(source.checkout));
let pr: PullRequest | undefined;
let prProblem: string | undefined;
if (prArg && !prUrlRepo && !/^\d+$/.test(prArg)) fail([`--pr "${prArg}"`], "--pr takes a PR number or https://github.com/<owner>/<repo>/pull/<n>.");
if (!repository) {
  prProblem = "no GitHub repository known (set \"repository\" or \"pr.url\" in the document, or use --pr <url>)";
} else {
  // Explicit PR first; otherwise the branch, then any PR containing the pinned head commit.
  const lookups: ({ ref: string } | { branch: string } | { commit: string })[] = prArg
    ? [{ ref: prArg }]
    : [...(doc.origin?.branch ? [{ branch: doc.origin.branch }] : []), { commit: pins.head }];
  try {
    for (const by of lookups) if ((pr = await findPullRequest(prUrlRepo ?? repository, by))) break;
    if (!pr) prProblem = `no pull request in ${repository} for ${doc.origin?.branch ? `branch "${doc.origin.branch}" or ` : ""}commit ${pins.head.slice(0, 7)}`;
  } catch (e) {
    // Offline or gh unavailable: a PR given explicitly still gets linked, just without title and state.
    const m = prArg ? GITHUB_PR_URL.exec(prArg) : undefined;
    if (m) pr = { url: prArg!, number: Number(m[2]) };
    else if (prArg) pr = { url: `https://github.com/${repository}/pull/${prArg}`, number: Number(prArg) };
    prProblem = `gh lookup failed (${(e as Error).message})`;
  }
}
if (prProblem) console.error(`warning: ${prProblem}${pr ? "; linking the PR without its title/state" : "; the page will say no PR is linked"}`);
// The page is pinned, so it can't drift; the PR can. Say so when its head is no longer the pinned commit.
const prHead = pr?.headRefOid && pr.headRefOid !== pins.head ? pr.headRefOid : undefined;
if (prHead) console.error(`warning: the PR head is ${prHead.slice(0, 7)}, but this page is pinned to ${pins.head.slice(0, 7)}`);

/** Link #123 and owner/repo#123 in rendered HTML text, outside links, code and attributes. */
function linkMentions(html: string): string {
  let skipDepth = 0;
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag: string | undefined, text: string | undefined) => {
    if (tag) {
      if (/^<(a|code|pre)[\s>]/i.test(tag)) skipDepth++;
      else if (/^<\/(a|code|pre)>/i.test(tag)) skipDepth = Math.max(0, skipDepth - 1);
      return tag;
    }
    if (skipDepth) return text!;
    return text!.replace(/(^|[\s(\[,;:])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g, (whole, lead: string, slug: string | undefined, num: string) => {
      const target = slug ?? repository;
      if (!target) return whole;
      const current = pr && target === (prUrlRepo ?? repository) && Number(num) === pr.number ? " current" : "";
      return `${lead}<a class="pr-mention${current}" href="https://github.com/${target}/pull/${num}" title="${target}#${num}">${slug ? `${slug}#${num}` : `#${num}`}</a>`;
    });
  });
}

// ---------------------------------------------------------------- html helpers

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (sha?: string) => (sha ? sha.slice(0, 7) : "");

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", sql: "sql", md: "markdown", yml: "yaml", yaml: "yaml", toml: "ini",
  go: "go", rs: "rust", py: "python", sh: "bash", css: "css", html: "xml",
};

// ---------------------------------------------------------------- collect code references

const refs = new Map<string, Ref>();
function ref(side: Side, file: string, from: number, to: number): Ref {
  const key = `${side}:${file}:${from}-${to}`;
  let r = refs.get(key);
  if (!r) {
    r = { id: `r${refs.size + 1}`, side, file, from, to };
    refs.set(key, r);
  }
  return r;
}
const rangeRef = (s: SourceRange) => ref(s.start.side, s.file, s.start.line, s.end.line);

const problems: string[] = [];
const LINK_RE = /^review-source:(base|head)\/([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$/;
function linkRef(href: string): Ref | undefined {
  const m = LINK_RE.exec(href);
  if (!m) return undefined;
  const from = m[3] ? Number(m[3]) : 1;
  const to = m[4] ? Number(m[4]) : m[3] ? from : Number.MAX_SAFE_INTEGER;
  return ref(m[1] as Side, decodeURI(m[2]!), from, to);
}

function collect(nodes: Block[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case "section":
        collect(n.children);
        break;
      case "markdown":
        for (const m of n.markdown.matchAll(/\]\((review-source:[^)\s]*)\)/g))
          if (!linkRef(m[1]!)) problems.push(`${n.id ?? "markdown"}: malformed link "${m[1]}" (want review-source:head/path#L10-L24)`);
        break;
      case "code_peek":
        rangeRef(n.source);
        break;
      case "flow_diagram":
        for (const node of n.nodes) for (const a of node.attachments ?? []) for (const s of a.sources) rangeRef(s);
        break;
      case "call_stack_diff":
        for (const f of [...n.base, ...n.head]) if (f.source) rangeRef(f.source);
        break;
      case "sequence":
        for (const s of n.steps) if (s.source) rangeRef(s.source);
        break;
      case "diff":
        slices.push(n);
        break;
    }
  }
}
collect(doc.document);

// Review items anchor on one head line each (registered so the range check covers them);
// their text may cite more lines (`metrics.ts:302`, `:349-374`).
const bodyRefs = new Map<string, LineRef[]>();
const warnings: string[] = [];
if (review) {
  for (const c of items) ref("head", c.path, c.line, c.line);
  const repoFiles = await source.listFiles("head");
  const prFiles = new Set([...(await source.diffFiles()), ...items.map((c) => c.path)]);
  for (const c of items) {
    const found = lineRefs(c, repoFiles, prFiles);
    bodyRefs.set(c.id, found.refs);
    warnings.push(...found.warnings.map((w) => `review.${itemsKey} (${c.id}) ref ${w}`));
  }
}
// Every proposed decision should say why, so the user can judge it without asking.
if (review?.kind === "self")
  for (const f of review.findings) if (!f.why) warnings.push(`review.findings (${f.id}): no "why" for the proposed ${f.decision}`);
// A PR-body change must quote the description as it is now, or the user can't see what it replaces.
if (review?.kind === "self") {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const body = pr?.body === undefined ? undefined : squash(pr.body);
  for (const f of review.findings) {
    if (f.target !== "pr_body" || !f.change?.current) continue;
    if (body === undefined) warnings.push(`review.findings (${f.id}): no PR body to check change.current against`);
    else if (!body.includes(squash(f.change.current))) warnings.push(`review.findings (${f.id}): change.current is not in the PR body; quote it verbatim`);
  }
}

// ---------------------------------------------------------------- fetch files, check every range, read diff

interface FileText { commit: string; lineCount: number; html: string[] }
// The Diff tab and the diff blocks in chapters slice one patch; every changed file is highlighted
// from its full text at both sides.
let allDiffFiles: DiffFile[] = [];
if (doc.diff || slices.length) {
  try {
    allDiffFiles = parsePatch(await source.patch([]));
  } catch (e) {
    fail([`diff: ${(e as Error).message}`], "Could not read the patch; nothing written.");
  }
}
const excluded = doc.diff && doc.diff !== true ? doc.diff.exclude : [];
const diffFiles = allDiffFiles.filter((f) => !excluded.some((g) => new Bun.Glob(g).match(f.path)));
const sliceFiles = new Map(slices.map((s) => [s, allDiffFiles.filter((f) => s.files.some((g) => new Bun.Glob(g).match(f.path)))]));
for (const s of slices)
  for (const g of s.files)
    if (!allDiffFiles.some((f) => new Bun.Glob(g).match(f.path))) problems.push(`${s.id ?? "diff"}: "${g}" matches no file the PR changes`);
// Like Plannotator's "unplaced files": once chapters carry diffs, say which changes no chapter shows.
if (slices.length) {
  const placed = new Set([...sliceFiles.values()].flat());
  const unplaced = diffFiles.filter((f) => !placed.has(f));
  if (unplaced.length) warnings.push(`${unplaced.length} changed file(s) in no diff block: ${unplaced.map((f) => f.path).join(", ")}`);
}
const shownDiffFiles = new Set([...diffFiles, ...[...sliceFiles.values()].flat()]);
const diffKeys = [...shownDiffFiles].filter((f) => !f.binary).flatMap((f) => [...(f.status !== "added" ? [`base:${f.path}`] : []), ...(f.status !== "deleted" ? [`head:${f.path}`] : [])]);
const fileKeys = [...new Set([...[...refs.values(), ...[...bodyRefs.values()].flat().map((r) => ({ side: "head", file: r.path }))].map((r) => `${r.side}:${r.file}`), ...diffKeys])];
const files = new Map<string, FileText>();
await pool(fileKeys, 6, async (key) => {
  const [side, ...rest] = key.split(":");
  const file = rest.join(":");
  try {
    const { commit, text } = await source.readFile(side as Side, file);
    const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    files.set(key, { commit, lineCount, html: highlightLines(text, file) });
  } catch (e) {
    problems.push(`${key}: ${(e as Error).message}`);
  }
});
for (const r of refs.values()) {
  const f = files.get(`${r.side}:${r.file}`);
  if (!f) continue;
  const wholeFile = r.to === Number.MAX_SAFE_INTEGER;
  if (r.from > f.lineCount || (!wholeFile && r.to > f.lineCount))
    problems.push(`${r.side}:${r.file}#L${r.from}${wholeFile ? "" : `-L${r.to}`}: file has only ${f.lineCount} lines at ${short(f.commit)}`);
}
// A ref in comment text that runs past the file is a warning: the text may mean another file.
const bodyRefIds = new Map<LineRef, string>();
for (const [id, list] of bodyRefs) {
  for (const r of list) {
    const f = files.get(`head:${r.path}`);
    if (f && r.from <= f.lineCount && r.to <= f.lineCount && r.to >= r.from) bodyRefIds.set(r, ref("head", r.path, r.from, r.to).id);
    else warnings.push(`review ${itemsKey} ${id}: ref ${r.text} → ${r.path} is outside the file at ${short(pins.head)}`);
  }
}
// GitHub rejects a comment on a line outside the PR diff's hunks. A skipped comment only warns.
// Self-review findings never post, so they may point anywhere in the file.
if (review?.kind === "colleague") {
  const hunks = await source.hunkLines([...new Set(review.comments.map((c) => c.path))]);
  review.comments.forEach((c, i) => {
    if (hunks.get(`head:${c.path}`)?.has(c.line)) return;
    const msg = `review.comments[${i}] (${c.id}): ${c.path}:${c.line} is not in a diff hunk at ${short(pins.head)}`;
    if (c.post) problems.push(msg);
    else warnings.push(`${msg} (skipped, so not posted)`);
  });
}
for (const w of warnings) console.error(`warning: ${w}`);
if (problems.length) fail(problems, `${problems.length} code reference problem(s); nothing written.`);

if (values.payload) {
  const out = values.out ?? join(dirname(input), `post-payload-${pins.head.slice(0, 8)}.json`);
  const payload = reviewPayload(review as ColleagueReview, pins.head);
  await Bun.write(out, JSON.stringify(payload, null, 2) + "\n");
  console.error(`wrote ${out} (event ${payload.event}, ${payload.comments.length} comment(s), commit_id ${short(pins.head)})`);
  console.log(out);
  process.exit(0);
}

let changed = new Map<string, Set<number>>();
try {
  changed = await source.changedLines([...new Set([...refs.values()].map((r) => r.file))]);
} catch (e) {
  console.error(`warning: no changed-line markers (${(e as Error).message})`);
}

/** Highlight a whole file once (so multi-line comments and strings are right), then split per line. */
function highlightLines(text: string, file: string): string[] {
  const lang = LANG[file.split(".").pop() ?? ""];
  const html = lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : esc(text);
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  for (const m of html.matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g)) {
    if (m[1]) open.push(m[1]), (cur += m[1]);
    else if (m[2]) open.pop(), (cur += m[2]);
    else if (m[3]) lines.push(cur + "</span>".repeat(open.length)), (cur = open.join(""));
    else cur += m[4];
  }
  lines.push(cur);
  return lines;
}

function codeBlock(r: Ref, label?: string, focus?: number): string {
  const f = files.get(`${r.side}:${r.file}`)!;
  const to = Math.min(r.to, f.lineCount);
  const range = r.from === to ? `L${r.from}` : `L${r.from}–${to}`;
  const caption = `<figcaption>${label ? `<span class="label">${esc(label)}</span>` : ""}
    <span class="path">${esc(r.file)}</span> <span class="range">${range}</span>
    <span class="side ${r.side}">${r.side} · ${short(f.commit)}</span></figcaption>`;
  const marks = changed.get(`${r.side}:${r.file}`);
  const kind = r.side === "head" ? "add" : "del";
  let rows = "";
  for (let n = r.from; n <= to; n++) {
    rows += `<div class="ln${marks?.has(n) ? ` ${kind}` : ""}${n === focus ? " focus" : ""}"><span class="no">${n}</span><span class="tx">${f.html[n - 1] || " "}</span></div>`;
  }
  return `<figure class="code">${caption}<div class="lines hljs">${rows}</div></figure>`;
}

// ---------------------------------------------------------------- markdown

const md = new Marked({ gfm: true });
md.use({
  renderer: {
    link(token: Tokens.Link) {
      const r = linkRef(token.href);
      if (!r) return false;
      return `<a href="#${r.id}" class="src-link" data-ref="${r.id}">${this.parser.parseInline(token.tokens)}</a>`;
    },
  },
  hooks: { postprocess: linkMentions },
});

// ---------------------------------------------------------------- flow diagram (dagre → static SVG)

const CHAR_W = { label: 7.6, desc: 6.6 };
const NODE_MAX_W = 250;

function wrap(text: string, charW: number, maxW: number): string[] {
  const perLine = Math.max(8, Math.floor(maxW / charW));
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > perLine) out.push(line), (line = word);
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

const templates: string[] = [];

function flowDiagram(n: BlockOf<"flow_diagram">): string {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: n.direction === "right" ? "LR" : "TB", nodesep: 28, ranksep: 46, edgesep: 14, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  const meta = new Map<string, { label: string[]; desc: string[]; node: (typeof n.nodes)[number] }>();
  for (const node of n.nodes) {
    const label = wrap(node.label, CHAR_W.label, NODE_MAX_W - 24);
    const desc = node.description ? wrap(node.description, CHAR_W.desc, NODE_MAX_W - 24) : [];
    const textW = Math.max(...label.map((l) => l.length * CHAR_W.label), ...desc.map((l) => l.length * CHAR_W.desc));
    const pad = node.kind === "decision" ? 44 : 24;
    meta.set(node.key, { label, desc, node });
    const hasCode = (node.attachments ?? []).some((a) => a.sources.length);
    g.setNode(node.key, { width: Math.min(NODE_MAX_W + pad, textW + pad), height: label.length * 17 + desc.length * 15 + (desc.length ? 8 : 0) + (hasCode ? 32 : 20) });
  }
  for (const e of n.edges ?? []) {
    const lbl = e.label ? { label: e.label, width: e.label.length * 6.4 + 10, height: 18, labelpos: "c" } : {};
    g.setEdge(e.from, e.to, { ...lbl, style: e.style });
  }
  dagre.layout(g);
  const { width = 0, height = 0 } = g.graph();

  let edges = "";
  for (const e of g.edges()) {
    // dagre's GraphEdge type omits the custom fields passed to setEdge.
    const ed = g.edge(e) as unknown as LaidOutEdge;
    const pts = ed.points;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    edges += `<path class="edge${ed.style === "dashed" ? " dashed" : ""}" d="${d}" marker-end="url(#arrow-${n.id})"/>`;
    if (ed.label) {
      edges += `<g class="edge-label"><rect x="${ed.x - ed.width / 2}" y="${ed.y - 9}" width="${ed.width}" height="18" rx="4"/>
        <text x="${ed.x}" y="${ed.y + 4}" text-anchor="middle">${esc(ed.label)}</text></g>`;
    }
  }

  let nodes = "";
  for (const key of g.nodes()) {
    const box = g.node(key);
    const m = meta.get(key)!;
    const { x, y, width: w, height: h } = box;
    const left = x - w / 2;
    const top = y - h / 2;
    const kind = m.node.kind ?? "process";
    const shape =
      kind === "decision"
        ? `<polygon points="${left + 14},${top} ${left + w - 14},${top} ${left + w},${y} ${left + w - 14},${top + h} ${left + 14},${top + h} ${left},${y}"/>`
        : `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${kind === "terminal" ? Math.min(h / 2, 20) : 6}"/>`;
    let ty = top + 22;
    let text = "";
    for (const l of m.label) text += `<text class="nl" x="${x}" y="${ty}" text-anchor="middle">${esc(l)}</text>`, (ty += 17);
    if (m.desc.length) ty += 4;
    for (const l of m.desc) text += `<text class="nd" x="${x}" y="${ty - 2}" text-anchor="middle">${esc(l)}</text>`, (ty += 15);
    const attachments = m.node.attachments ?? [];
    const count = attachments.reduce((s, a) => s + a.sources.length, 0);
    const tid = `node-${n.id}-${key}`;
    const badge = count ? `<text class="badge" x="${left + w - 8}" y="${top + h - 7}" text-anchor="end">&lt;/&gt; ${count} code</text>` : "";
    nodes += `<g class="fnode kind-${esc(kind)}${count ? " has-code" : ""}"${count ? ` data-tpl="${tid}" tabindex="0" role="button"` : ""}>${shape}${text}${badge}</g>`;
    if (count) {
      const body = attachments.map((a) => a.sources.map((s) => codeBlock(rangeRef(s), a.label)).join("")).join("");
      const head = `<h3>${esc(m.node.label)}</h3>${m.node.description ? `<p>${esc(m.node.description)}</p>` : ""}`;
      templates.push(`<template id="${tid}">${head}${body}</template>`);
    }
  }

  return `<figure class="flow" id="${esc(n.id)}">
    ${n.title ? `<figcaption>${esc(n.title)}</figcaption>` : ""}${n.description ? `<p class="figure-desc">${esc(n.description)}</p>` : ""}
    <div class="flow-scroll"><svg viewBox="0 0 ${width} ${height}" style="max-width:${width}px" role="img" aria-label="${esc(n.title ?? "flow diagram")}">
      <defs><marker id="arrow-${n.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
      ${edges}${nodes}
    </svg></div>
    <p class="hint">Click a node with &lt;/&gt; to see its code.</p>
  </figure>`;
}

// ---------------------------------------------------------------- call stack diff

type Frame = BlockOf<"call_stack_diff">["base"][number];
function callStackDiff(n: BlockOf<"call_stack_diff">): string {
  const baseByKey = new Map(n.base.map((f) => [f.key, f]));
  const headByKey = new Map(n.head.map((f) => [f.key, f]));

  const column = (frames: Frame[], other: Map<string, Frame>, side: Side) => {
    const depth = new Map<string, number>();
    const byKey = new Map(frames.map((f) => [f.key, f]));
    const level = (f: Frame): number => {
      if (depth.has(f.key)) return depth.get(f.key)!;
      const parent = f.parentKey ? byKey.get(f.parentKey) : undefined;
      const d = parent ? level(parent) + 1 : 0;
      depth.set(f.key, d);
      return d;
    };
    return frames
      .map((f) => {
        const twin = other.get(f.key);
        const status = !twin ? (side === "head" ? "added" : "removed") : twin.label !== f.label ? "modified" : "same";
        const r = f.source ? rangeRef(f.source) : undefined;
        return `<details class="frame ${status}" style="--depth:${level(f)}">
          <summary><span class="frame-label">${esc(f.label)}</span>${status === "same" ? "" : `<span class="pill ${status}">${status}</span>`}</summary>
          ${r ? codeBlock(r) : ""}
        </details>`;
      })
      .join("");
  };

  return `<figure class="callstack" id="${esc(n.id)}">
    ${n.title ? `<figcaption>${esc(n.title)}</figcaption>` : ""}
    <div class="stacks">
      <div><h4>Before <span class="side base">base${pins.base ? ` · ${short(pins.base)}` : ""}</span></h4>${column(n.base, headByKey, "base")}</div>
      <div><h4>After <span class="side head">head · ${short(pins.head)}</span></h4>${column(n.head, baseByKey, "head")}</div>
    </div>
  </figure>`;
}

// ---------------------------------------------------------------- sequence diagram

function sequenceDiagram(n: BlockOf<"sequence">): string {
  const actors = Object.entries(n.actors);
  const steps = n.steps;
  const COL_W = 180;
  const ROW_H = 46;
  const actorLines = new Map(actors.map(([key, label]) => [key, wrap(label, CHAR_W.label, COL_W - 30)]));
  const headH = Math.max(1, ...[...actorLines.values()].map((l) => l.length)) * 17 + 16;
  const xOf = new Map(actors.map(([key], i) => [key, 20 + COL_W / 2 + i * COL_W]));
  const width = actors.length * COL_W + 40;
  const firstRow = 10 + headH + 24;
  const bottomTop = firstRow + steps.length * ROW_H + 10;
  const height = bottomTop + headH + 10;

  const actorBox = (key: string, top: number) => {
    const x = xOf.get(key)!;
    const lines = actorLines.get(key)!;
    const text = lines.map((l, i) => `<text class="nl" x="${x}" y="${top + 22 + i * 17}" text-anchor="middle">${esc(l)}</text>`).join("");
    return `<g class="seq-actor"><rect x="${x - COL_W / 2 + 10}" y="${top}" width="${COL_W - 20}" height="${headH}" rx="6"/>${text}</g>`;
  };

  let svg = "";
  for (const [key] of actors) {
    const x = xOf.get(key)!;
    svg += `<line class="lifeline" x1="${x}" y1="${10 + headH}" x2="${x}" y2="${bottomTop}"/>`;
    svg += actorBox(key, 10) + actorBox(key, bottomTop);
  }
  steps.forEach((s, i) => {
    const y = firstRow + i * ROW_H + ROW_H / 2 + 6;
    const x1 = xOf.get(s.from) ?? 0;
    const x2 = xOf.get(s.to) ?? 0;
    const cls = `edge${s.style === "return" ? " dashed" : s.style === "async" ? " async" : ""}`;
    const path = x1 === x2 ? `M${x1},${y - 8} h36 v16 h-34` : `M${x1},${y} L${x2 + (x2 > x1 ? -2 : 2)},${y}`;
    const labelX = x1 === x2 ? x1 + 42 : (x1 + x2) / 2;
    const anchor = x1 === x2 ? "start" : "middle";
    const label = `<text class="seq-label" x="${labelX}" y="${x1 === x2 ? y + 4 : y - 7}" text-anchor="${anchor}"><tspan class="seq-no">${i + 1}.</tspan> ${esc(s.label)}</text>`;
    if (!s.source && !s.explanation) {
      svg += `<g class="seq-step"><path class="${cls}" d="${path}" marker-end="url(#arrow-${n.id})"/>${label}</g>`;
      return;
    }
    const tid = `step-${n.id}-${i}`;
    const hit = `<rect class="hit" x="${Math.min(x1, x2) - 10}" y="${y - 22}" width="${Math.max(Math.abs(x2 - x1), 60) + 20}" height="34"/>`;
    svg += `<g class="seq-step has-code" data-tpl="${tid}" tabindex="0" role="button">${hit}<path class="${cls}" d="${path}" marker-end="url(#arrow-${n.id})"/>${label}</g>`;
    const explanation = s.explanation ? `<div class="md">${md.parse(s.explanation) as string}</div>` : "";
    templates.push(`<template id="${tid}"><h3>${i + 1}. ${esc(s.label)}</h3><p>${esc(n.actors[s.from] ?? s.from)} → ${esc(n.actors[s.to] ?? s.to)}</p>${explanation}${s.source ? codeBlock(rangeRef(s.source)) : ""}</template>`);
  });

  return `<figure class="flow sequence" id="${esc(n.id)}">
    ${n.title ? `<figcaption>${esc(n.title)}</figcaption>` : ""}
    <div class="flow-scroll"><svg viewBox="0 0 ${width} ${height}" style="max-width:${width}px" role="img" aria-label="${esc(n.title ?? "sequence diagram")}">
      <defs><marker id="arrow-${n.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
      ${svg}
    </svg></div>
    <p class="hint">Click a step to see its code.</p>
  </figure>`;
}

// ---------------------------------------------------------------- document

const toc: { id: string; title: string; depth: number }[] = [];
const diffCtx = { esc, lineHtml: (side: Side, path: string, n: number) => files.get(`${side}:${path}`)?.html[n - 1] };

function render(nodes: Block[], depth: number): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "section": {
          const id = n.id ?? `s${toc.length + 1}`;
          toc.push({ id, title: n.title, depth });
          const h = Math.min(depth + 2, 6);
          // Top-level sections are chapters: a Reviewed box collapses one once the user has read it.
          const done = depth === 0 ? `<label class="reviewed"><input type="checkbox" data-reviewed="${esc(id)}"> Reviewed</label>` : "";
          return `<section id="${esc(id)}"${depth === 0 ? ` class="chapter"` : ""}><h${h}>${linkMentions(esc(n.title))}${done}</h${h}>${render(n.children, depth + 1)}</section>`;
        }
        case "markdown":
          return `<div class="md" id="${esc(n.id)}">${md.parse(n.markdown) as string}</div>`;
        case "code_peek":
          return `<div id="${esc(n.id)}">${codeBlock(rangeRef(n.source), n.caption)}</div>`;
        case "flow_diagram":
          return flowDiagram(n);
        case "call_stack_diff":
          return callStackDiff(n);
        case "sequence":
          return sequenceDiagram(n);
        case "divider":
          return "<hr>";
        case "diff": {
          const id = n.id ?? `slice${slices.indexOf(n) + 1}`;
          return `<figure class="diff-slice" id="${esc(id)}">${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ""}${renderFiles(sliceFiles.get(n)!, diffCtx, id)}</figure>`;
        }
      }
    })
    .join("\n");
}

const body = render(doc.document, 0);
const excerpt = (c: ReviewItem) => {
  const lineCount = files.get(`head:${c.path}`)!.lineCount;
  return codeBlock(ref("head", c.path, Math.max(1, c.line - 3), Math.min(lineCount, c.line + 3)), undefined, c.line);
};
const ctx = { esc, markdown: (s: string) => md.parse(s) as string, excerpt, refLink: (r: LineRef) => bodyRefIds.get(r) };
const reviewTab = !review ? "" : review.kind === "self" ? renderSelfReview(review, bodyRefs, ctx) : renderReview(review, bodyRefs, ctx);
const diffTab = doc.diff ? renderDiff(diffFiles, diffCtx) : "";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tabs: [name: string, label: string, html: string][] = [
  ["walkthrough", "Walkthrough", body],
  ...(review ? [["review", review.kind === "self" ? `Self-review · ${plural(review.findings.length, "finding")}` : `Review · ${plural(items.length, "comment")}`, reviewTab] as [string, string, string]] : []),
  ...(doc.diff ? [["diff", `Diff · ${plural(diffFiles.length, "file")}`, diffTab] as [string, string, string]] : []),
];
for (const r of refs.values()) templates.push(`<template id="tpl-${r.id}">${codeBlock(r)}</template>`);

const read = (...path: string[]) => Bun.file(join(import.meta.dir, ...path)).text();
const css = await read("page.css");
const js = await read("page.js");

const prState = pr?.state === "OPEN" && pr.isDraft ? "draft" : pr?.state?.toLowerCase();
const prBanner = pr
  ? `<a class="pr-banner" href="${esc(pr.url)}" target="_blank" rel="noopener">
      <span class="pr-kicker">Pull request</span>
      <span class="pr-ref">${esc(prUrlRepo ?? repository)}#${pr.number}</span>
      ${pr.title ? `<span class="pr-title">${esc(pr.title)}</span>` : ""}
      ${prState ? `<span class="pr-state ${prState}">${prState}</span>` : ""}
      <span class="pr-open">Open on GitHub ↗</span>
    </a>`
  : `<div class="pr-banner none"><span class="pr-kicker">Pull request</span><span class="pr-title">Not linked: ${esc(prProblem)}</span></div>`;
const prMoved = prHead
  ? `<div class="pr-moved">The PR head is <code>${short(prHead)}</code>, but this page is pinned to <code>${short(pins.head)}</code>. Re-pin and rerun to see the latest commits.</div>`
  : "";
const meta = [
  doc.origin?.branch && `<span>branch <code>${esc(doc.origin.branch)}</code></span>`,
  pins && `<span><code>${short(pins.base)}</code> → <code>${short(pins.head)}</code></span>`,
  `<span>exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</span>`,
  `<button class="theme-toggle" type="button" aria-label="Toggle light and dark theme">theme</button>`,
]
  .filter(Boolean)
  .join("");

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="diffdeck (${esc(source.label)})">
<title>${pr ? `#${pr.number} · ` : ""}${esc(doc.title)}</title>
<script>(() => { let t; try { t = localStorage.getItem("dd-theme"); } catch {} document.documentElement.dataset.theme = t || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); })();</script>
<style>${theme.css}
${css}</style>
</head>
<body data-doc-key="${esc(`dd-reviewed:${prUrlRepo ?? repository ?? doc.title}#${pr?.number ?? ""}:${pins.head}`)}"${review ? ` data-review-key="${esc(`dd-${review.kind === "self" ? "self" : "review"}:${prUrlRepo ?? repository ?? doc.title}#${pr?.number ?? ""}:${pins.head}`)}" data-review-title="${esc(`${prUrlRepo ?? repository ?? ""}${pr ? `#${pr.number}` : ""}`)} @ ${short(pins.head)}"` : ""}>
<nav class="toc"><div class="toc-title">Contents</div>${toc
  .map((t) => `<a href="#${esc(t.id)}" style="--depth:${t.depth}">${esc(t.title)}</a>`)
  .join("")}</nav>
<main>
<header>${prBanner}${prMoved}<h1>${linkMentions(esc(doc.title))}</h1><div class="meta">${meta}</div>${
  tabs.length > 1
    ? `<div class="tabs" role="tablist">${tabs.map(([name, label], i) => `<button type="button" role="tab" data-tab="${name}" aria-selected="${i === 0}">${esc(label)}</button>`).join("")}</div>`
    : ""
}</header>
${tabs.length > 1 ? tabs.map(([name, , html], i) => `<div class="tab-panel" data-panel="${name}"${i ? " hidden" : ""}>${html}</div>`).join("") : body}
</main>
<aside class="drawer" aria-hidden="true"><button class="drawer-close" aria-label="Close">×</button><div class="drawer-body"></div></aside>
${templates.join("\n")}
<script>${js}</script>
</body>
</html>
`;

// Files start with "<repo>-<pr number>-" (e.g. mcp-427-…) so they sort and match by PR; just "<repo>-" without a PR.
const repoName = (prUrlRepo ?? repository)?.split("/")[1];
const prefix = [repoName, pr?.number].filter(Boolean).join("-");
const withPrefix = (name: string) => (!prefix || name.startsWith(`${prefix}-`) ? name : `${prefix}-${name.startsWith(`${repoName}-`) ? name.slice(repoName!.length + 1) : name}`);
const outPath = values.out ?? join(dirname(input), withPrefix(basename(input, ".json")) + ".html");
await Bun.write(outPath, html);
console.error(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, ${refs.size} code refs from ${files.size} files)`);
if (!values.serve) {
  console.log(outPath);
  if (values.open) Bun.spawnSync(["open", outPath]);
} else {
  // Serve the page and wait for "Send to agent". The response is the only stdout, so an agent that
  // runs this as a background job gets the user's response as the job's result.
  // The token travels in a custom header: other sites can't send it without a CORS preflight, which
  // this server never answers. The Host check stops DNS rebinding from reading the page and its token.
  const token = crypto.randomUUID();
  const served = html.replace("<body ", `<body data-send-token="${token}" `);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.hostname !== "127.0.0.1") return new Response("forbidden", { status: 403 });
      if (req.method === "GET" && url.pathname === "/") return new Response(served, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (req.method !== "POST" || url.pathname !== "/send") return new Response("not found", { status: 404 });
      if (req.headers.get("x-dd-token") !== token) return new Response("forbidden", { status: 403 });
      const text = await req.text();
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
      // Answer first, then stop: the page shows "Sent" from this response.
      setTimeout(() => process.exit(0), 100);
      return new Response("ok");
    },
  });
  console.error(`serving ${server.url.href}; waiting for "Send to agent" (Ctrl-C stops without a response)`);
  if (values.open) Bun.spawnSync(["open", server.url.href]);
}
