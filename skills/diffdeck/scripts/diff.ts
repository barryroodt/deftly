/**
 * Diff tab: the PR's base → head patch, file by file, so the reader can see every change without
 * opening GitHub. Lines are highlighted from the whole file at each side, so strings and comments
 * that span lines colour correctly.
 */

export interface DiffLine { kind: " " | "+" | "-"; old?: number; new?: number; text: string }
export interface Hunk { header: string; lines: DiffLine[] }
export interface DiffFile { path: string; status: "added" | "deleted" | "modified"; binary: boolean; hunks: Hunk[]; adds: number; dels: number }

/** Parse `git diff --no-renames` output. */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      file = { path: header[2]!, status: "modified", binary: false, hunks: [], adds: 0, dels: 0 };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("Binary files ")) file.binary = true;
    }
    const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (at) {
      [oldNo, newNo] = [Number(at[1]), Number(at[2])];
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const kind = line[0];
    if (kind === "+") hunk.lines.push({ kind, new: newNo++, text: line.slice(1) }), file.adds++;
    else if (kind === "-") hunk.lines.push({ kind, old: oldNo++, text: line.slice(1) }), file.dels++;
    else if (kind === " ") hunk.lines.push({ kind, old: oldNo++, new: newNo++, text: line.slice(1) });
    // "\ No newline at end of file" and the trailing empty line carry no content.
  }
  return files;
}

export interface DiffContext {
  esc(s: unknown): string;
  /** Highlighted HTML for a line at a side, if the file was read. */
  lineHtml(side: "base" | "head", path: string, n: number): string | undefined;
}

// Files with more changed lines than this start collapsed, so one generated file doesn't bury the rest.
const COLLAPSE_AT = 400;

const stat = (f: { adds: number; dels: number }) => `<span class="df-add">+${f.adds}</span> <span class="df-del">−${f.dels}</span>`;

/** One collapsible card per file. `idPrefix` makes the anchors unique when a page shows several slices. */
export function renderFiles(files: DiffFile[], x: DiffContext, idPrefix: string): string {
  const row = (l: DiffLine, path: string) => {
    const html = l.kind === "-" ? x.lineHtml("base", path, l.old!) : x.lineHtml("head", path, l.new!);
    const cls = l.kind === "+" ? " add" : l.kind === "-" ? " del" : "";
    return `<div class="ln${cls}"><span class="no">${l.old ?? ""}</span><span class="no">${l.new ?? ""}</span><span class="mk">${l.kind === " " ? "" : l.kind === "-" ? "−" : "+"}</span><span class="tx">${html ?? x.esc(l.text)}</span></div>`;
  };
  return files
    .map((f, i) => {
      const body = f.binary
        ? `<p class="df-note">Binary file; not shown.</p>`
        : f.hunks.length
          ? `<div class="lines hljs">${f.hunks.map((h) => `<div class="df-hunk">${x.esc(h.header)}</div>${h.lines.map((l) => row(l, f.path)).join("")}`).join("")}</div>`
          : `<p class="df-note">No content change (mode only).</p>`;
      return `<details class="df-file" id="${idPrefix}-${i}"${f.adds + f.dels > COLLAPSE_AT ? "" : " open"}>
        <summary><code>${x.esc(f.path)}</code>${f.status !== "modified" ? ` <span class="pill ${f.status === "added" ? "added" : "removed"}">${f.status}</span>` : ""}<span class="df-stat">${stat(f)}</span></summary>
        ${body}
      </details>`;
    })
    .join("\n");
}

export function renderDiff(files: DiffFile[], x: DiffContext): string {
  const adds = files.reduce((s, f) => s + f.adds, 0);
  const dels = files.reduce((s, f) => s + f.dels, 0);
  // One row per file: muted directory, bold file name, status, counts and a 5-block bar like GitHub's.
  const list = files
    .map((f, i) => {
      const cut = f.path.lastIndexOf("/") + 1;
      const total = f.adds + f.dels;
      const green = total ? Math.round((f.adds / total) * 5) : 0;
      const bar = [...Array(5)].map((_, b) => `<i class="${b < green ? "a" : b < (total ? 5 : 0) ? "d" : ""}"></i>`).join("");
      return `<li><a class="df-row" href="#diff-${i}">
        <span class="df-path"><span class="df-dir">${x.esc(f.path.slice(0, cut))}</span><span class="df-name">${x.esc(f.path.slice(cut))}</span>${f.status !== "modified" ? `<span class="pill ${f.status === "added" ? "added" : "removed"}">${f.status}</span>` : f.binary ? `<span class="pill">binary</span>` : ""}</span>
        <span class="df-num">${stat(f)}</span><span class="df-bar">${bar}</span></a></li>`;
    })
    .join("");
  return `<div class="diff">
    <h2>Files changed <span class="rv-count">${files.length} · ${stat({ adds, dels })}</span></h2>
    <ul class="df-list">${list}</ul>
    ${renderFiles(files, x, "diff")}
  </div>`;
}
