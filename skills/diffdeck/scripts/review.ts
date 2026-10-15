/**
 * Review tab, in two kinds. A colleague review is a draft PR review (body, event, inline comments)
 * that the reader edits and sends back with Respond, plus the GitHub payload built from an approved
 * round; diffdeck never posts. A self-review lists findings on the reader's own PR, each with a
 * Fix / Skip / Discuss decision and a note for the agent; nothing in it is ever posted.
 */
import type { ColleagueReview, ReviewItem, SelfReview } from "./schema.ts";

/** A `file.ts:12` or `:12-20` mention in comment text, resolved to a repo path. */
export interface LineRef { text: string; path: string; from: number; to: number }

// A file name and/or a line ref, after the start, whitespace, "(", "," or a backtick: `metrics.ts`,
// `metrics.ts:428-431`, `:302`. Times ("10:30") and URLs ("https://") don't match.
const MENTION = /(^|[\s(`,])((?:[\w-]+\/)*[\w.-]+\.[A-Za-z]\w*)?(?::(\d+)(?:-(\d+))?)?(?![\w:])/g;

/**
 * Find line refs in a comment. A bare `:N` right after a short name (`controller :1134`) points at
 * the one PR file whose name has that word as a dot-separated part (`mcp.controller.ts`). Any other
 * bare `:N` points at the file named last before it in the same comment, else the comment's own
 * file. See resolvePath for full names.
 */
export function lineRefs(c: ReviewItem, repoFiles: string[], prFiles: Set<string>): { refs: LineRef[]; warnings: string[] } {
  const refs: LineRef[] = [];
  const warnings: string[] = [];
  let current = c.path;
  for (const m of c.body.matchAll(MENTION)) {
    const [, lead, name, from, to] = m;
    if (!name && !from) continue;
    let path = current;
    let alias = "";
    if (name) {
      const found = resolvePath(name, c.path, repoFiles, prFiles);
      if (typeof found !== "string") {
        // A name without a line may be prose ("e.g."); only a line ref is worth a warning.
        if (from) warnings.push(`"${name}:${from}${to ? `-${to}` : ""}": ${found.problem}`);
        continue;
      }
      path = current = found;
    } else {
      const word = /([A-Za-z][\w-]*) $/.exec(c.body.slice(0, m.index + lead!.length))?.[1];
      const hits = word ? [...prFiles].filter((f) => f.split("/").pop()!.toLowerCase().split(".").slice(0, -1).includes(word.toLowerCase())) : [];
      if (hits.length === 1) [path, current, alias] = [hits[0]!, hits[0]!, `${word} `];
    }
    if (from) refs.push({ text: `${alias}${name ?? ""}:${from}${to ? `-${to}` : ""}`, path, from: Number(from), to: Number(to ?? from) });
  }
  return { refs, warnings };
}

/**
 * A name matches a repo path exactly, or as a path ending in `/<name>`. Of several, a PR file wins,
 * then the one sharing the most leading directories with the comment's file.
 */
function resolvePath(name: string, own: string, repoFiles: string[], prFiles: Set<string>): string | { problem: string } {
  if (repoFiles.includes(name)) return name;
  const matches = repoFiles.filter((f) => f.endsWith(`/${name}`));
  if (matches.length <= 1) return matches[0] ?? { problem: "no file with that name at head" };
  const inPr = matches.filter((f) => prFiles.has(f));
  if (inPr.length === 1) return inPr[0]!;
  const ownDirs = own.split("/");
  const shared = (f: string) => {
    const dirs = f.split("/");
    let n = 0;
    while (n < dirs.length - 1 && dirs[n] === ownDirs[n]) n++;
    return n;
  };
  const best = Math.max(...matches.map(shared));
  const nearest = matches.filter((f) => shared(f) === best);
  return nearest.length === 1 ? nearest[0]! : { problem: `${nearest.length} files match equally (${nearest.slice(0, 3).join(", ")}…)` };
}

/** Body of `POST /repos/{o}/{r}/pulls/{n}/reviews`: one review pinned to the head commit. */
export function reviewPayload(r: ColleagueReview, commitId: string) {
  return {
    commit_id: commitId,
    event: r.event,
    body: r.body,
    comments: r.comments.filter((c) => c.post).map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
  };
}

export interface RenderContext {
  esc(s: unknown): string;
  markdown(s: string): string;
  /** The excerpt around a comment's line, with that line marked. */
  excerpt(c: ReviewItem): string;
  /** Drawer link id for a resolved line ref, or undefined if it failed validation. */
  refLink(r: LineRef): string | undefined;
}

/** Items in theme order (first-seen), numbered 1..N in that order. */
function byTheme<T extends { id: string; theme?: string }>(items: T[]) {
  const themes: string[] = [];
  for (const c of items) if (!themes.includes(c.theme ?? "")) themes.push(c.theme ?? "");
  const ordered = themes.flatMap((t) => items.filter((c) => (c.theme ?? "") === t));
  const number = new Map(ordered.map((c, i) => [c.id, i + 1]));
  const groups = (card: (c: T) => string) =>
    themes.map((t) => `${t ? `<h3>${t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)}</h3>` : ""}${items.filter((c) => (c.theme ?? "") === t).map(card).join("\n")}`).join("\n");
  return { ordered, number, groups };
}

/** Line refs in an item's text as chips that open the code; a ref outside its file shows as a warning chip. */
function refChips(id: string, refsById: Map<string, LineRef[]>, x: RenderContext): string {
  const chips = (refsById.get(id) ?? [])
    .map((ref) => {
      const link = x.refLink(ref);
      const title = `${ref.path}:${ref.from}${ref.to !== ref.from ? `-${ref.to}` : ""}`;
      return link
        ? `<a href="#${link}" class="src-link ref-chip" data-ref="${link}" title="${x.esc(title)}">${x.esc(ref.text)}</a>`
        : `<span class="ref-chip bad" title="${x.esc(title)}: outside the file at head">${x.esc(ref.text)}</span>`;
    })
    .join("");
  return chips ? `<div class="rv-refs"><span>Refs</span>${chips}</div>` : "";
}

const heldOut = (items: string[] | undefined, x: RenderContext, note: string) =>
  items?.length ? `<section class="rv-held"><h2>Held out</h2><p class="rv-note">${note}</p><div class="md"><ul>${items.map((h) => `<li>${x.markdown(h)}</li>`).join("")}</ul></div></section>` : "";

/**
 * The colleague Review tab. Originals go into a JSON block so page.js can diff edits and build the
 * response. A posted review renders read-only: no edits, no Respond, labels say what went live.
 */
export function renderReview(r: ColleagueReview, refsById: Map<string, LineRef[]>, x: RenderContext): string {
  const live = r.posted;
  const ro = live ? " disabled" : "";
  const { ordered, number, groups } = byTheme(r.comments);

  const card = (c: ColleagueReview["comments"][number]) => {
    const chips = refChips(c.id, refsById, x);
    return `<article class="rv-card" data-key="${x.esc(c.id)}">
      <header class="rv-head">
        <label class="rv-post"><input type="checkbox" data-post="${x.esc(c.id)}"${c.post ? " checked" : ""}${ro}>
          <b>${number.get(c.id)}</b> · <code>${x.esc(c.path)}:${c.line}</code></label>
        <span class="rv-flag" hidden>edited</span><button type="button" class="rv-revert" hidden>Revert</button>
        <span class="rv-status${live ? (c.post ? " posted" : " skipped") : ""}">${live ? (c.post ? "Posted" : "Skipped") : "Not posted"}</span>
      </header>
      <textarea class="rv-text" data-text="${x.esc(c.id)}" spellcheck="true"${live ? " readonly" : ""}>${x.esc(c.body)}</textarea>
      ${chips}
      ${x.excerpt(c)}
      ${c.relates_to ? `<a class="rv-relates" href="#${x.esc(c.relates_to)}">See in walkthrough ↗</a>` : ""}
    </article>`;
  };

  const events = (["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const)
    .map((e) => `<label><input type="radio" name="rv-event" value="${e}"${r.event === e ? " checked" : ""}${ro}> ${e === "REQUEST_CHANGES" ? "Request changes" : e[0] + e.slice(1).toLowerCase()}</label>`)
    .join("");
  const cards = groups(card);
  const data = {
    kind: "colleague",
    event: r.event,
    body: r.body,
    comments: ordered.map((c) => ({ id: c.id, n: number.get(c.id), path: c.path, line: c.line, body: c.body, post: c.post })),
  };

  const banner = live
    ? `<a class="pr-banner rv-live" href="${x.esc(live.url)}" target="_blank" rel="noopener"><span class="pr-kicker">Posted</span>
        <span class="pr-title">Review ${live.review_id} is live at <code>${x.esc(live.commit_id.slice(0, 7))}</code>. This page is a read-only record; edit a new round to change anything.</span>
        <span class="pr-open">Open on GitHub ↗</span></a>`
    : "";
  return `<div class="review">
    ${banner}
    ${r.verdict ? `<section class="rv-verdict"><h2>AI review</h2><div class="md">${x.markdown(r.verdict)}</div></section>` : ""}
    <section class="rv-card rv-body" data-key="body">
      <header class="rv-head"><span class="rv-title">Review body</span>
        <span class="rv-flag" hidden>edited</span><button type="button" class="rv-revert" hidden>Revert</button>
        <span class="rv-status${live ? " posted" : ""}">${live ? "Posted" : "Not posted"}</span></header>
      <textarea class="rv-text" data-text="body" spellcheck="true"${live ? " readonly" : ""}>${x.esc(r.body)}</textarea>
      <div class="rv-event">${events}</div>
    </section>
    <h2>Inline comments <span class="rv-count">${r.comments.length}</span></h2>
    ${cards}
    ${heldOut(r.held_out, x, "Kept in the internal report. Not posted.")}
    ${live ? "" : `<div class="rv-bar"><button type="button" class="rv-respond">Respond</button></div>
    <script type="application/json" id="review-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`}
  </div>`;
}

const DECISIONS = [
  ["fix", "Fix"],
  ["skip", "Skip"],
  ["discuss", "Discuss"],
] as const;

/**
 * The self-review tab: each finding is read-only text with a Fix / Skip / Discuss choice, preset to
 * the agent's proposal, and a note that steers the fix. A finding targets a code line or the PR
 * body; `change` shows the exact before/after, and a PR-body change's proposed text is editable.
 * page.js draws the word highlights (it re-runs them as the user edits). No body, event or payload.
 */
export function renderSelfReview(r: SelfReview, refsById: Map<string, LineRef[]>, x: RenderContext): string {
  const { ordered, number, groups } = byTheme(r.findings);
  const where = (f: SelfReview["findings"][number]) => (f.target === "pr_body" ? "PR body" : `${f.path}:${f.line}`);
  const change = (f: SelfReview["findings"][number]) => {
    if (!f.change) return "";
    const editable = f.target === "pr_body";
    const now = f.change.current ? `<div class="sr-now"><span class="sr-label">Now</span><div class="sr-text" data-now>${x.esc(f.change.current)}</div></div>` : "";
    const tools = editable
      ? `<span class="sr-tools"><span class="rv-flag" hidden>edited</span><button type="button" class="rv-revert" hidden>Revert</button><button type="button" class="sr-edit">Edit</button></span>`
      : "";
    return `<div class="sr-change${editable ? "" : " mono"}" data-change="${x.esc(f.id)}">${now}<div class="sr-new">
        <span class="sr-label">${f.change.current ? "Proposed" : "Add"}${tools}</span>
        <div class="sr-text" data-new>${x.esc(f.change.proposed)}</div>
        ${editable ? `<textarea class="sr-edit-box" data-proposed="${x.esc(f.id)}" spellcheck="true" hidden>${x.esc(f.change.proposed)}</textarea>` : ""}
      </div></div>`;
  };
  const card = (f: SelfReview["findings"][number]) => `<article class="rv-card sr-card" data-key="${x.esc(f.id)}" data-decision="${f.decision}">
      <header class="rv-head"><span class="rv-post"><b>${number.get(f.id)}</b> · ${f.target === "pr_body" ? `<span class="pill sr-target">PR body</span>` : `<code>${x.esc(where(f))}</code>`}</span>
        <span class="rv-flag" hidden>changed</span></header>
      <div class="md sr-body">${x.markdown(f.body)}</div>
      ${change(f)}
      ${refChips(f.id, refsById, x)}
      ${f.target === "code" ? x.excerpt({ ...f, path: f.path!, line: f.line! }) : ""}
      <div class="sr-decide">${DECISIONS.map(([v, label]) => `<label><input type="radio" name="sr-${x.esc(f.id)}" data-decision="${x.esc(f.id)}" value="${v}"${f.decision === v ? " checked" : ""}> ${label}${f.decision === v ? ` <small>proposed</small>` : ""}</label>`).join("")}
        ${f.why ? `<div class="sr-why"><b>Why ${f.decision}:</b> ${x.markdown(f.why).replace(/^<p>|<\/p>\s*$/g, "")}</div>` : ""}</div>
      <textarea class="sr-note" data-note="${x.esc(f.id)}" rows="1" placeholder="Note for the agent (optional), e.g. fix it but keep the name"></textarea>
      ${f.relates_to ? `<a class="rv-relates" href="#${x.esc(f.relates_to)}">See in walkthrough ↗</a>` : ""}
    </article>`;
  const data = {
    kind: "self",
    findings: ordered.map((f) => ({ id: f.id, n: number.get(f.id), where: where(f), decision: f.decision, current: f.change?.current, proposed: f.change?.proposed })),
  };
  const count = (d: string) => r.findings.filter((f) => f.decision === d).length;
  return `<div class="review">
    ${r.verdict ? `<section class="rv-verdict"><h2>AI review</h2><div class="md">${x.markdown(r.verdict)}</div></section>` : ""}
    <h2>Findings <span class="rv-count">${r.findings.length} · proposed ${count("fix")} fix, ${count("skip")} skip, ${count("discuss")} discuss</span></h2>
    <p class="rv-note">Nothing here is posted. Pick what the agent changes on your branch, then Respond.</p>
    ${groups(card)}
    ${heldOut(r.held_out, x, "Kept in the internal report. No decision needed.")}
    <div class="rv-bar"><button type="button" class="rv-respond">Respond</button></div>
    <script type="application/json" id="review-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
  </div>`;
}
