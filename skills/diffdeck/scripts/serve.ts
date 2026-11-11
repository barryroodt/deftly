/**
 * What every diffdeck page shares: the HTML shell, writing the file, and `--serve`, which serves the
 * page on 127.0.0.1 and prints the reader's response to stdout when they press "Send to agent".
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface TocEntry {
  id: string;
  title: string;
  depth: number;
  /** Tooltip for a shortened title, e.g. a file's full path. */
  tip?: string;
}

export interface Page {
  /** The <title>, already including any "#123 · " prefix. */
  title: string;
  /** Where the page came from, for the generator meta tag: the walkthrough file's name. */
  source: string;
  themeCss: string;
  /** Extra attributes on <body>, starting with a space; `data-doc-key` is required by page.js. */
  bodyAttrs: string;
  toc: TocEntry[];
  /** Contents for the other tabs, keyed by tab name. page.js shows the list that matches the open tab. */
  tabTocs?: Record<string, TocEntry[]>;
  /** Everything inside <header>. */
  header: string;
  main: string;
  /** Drawer templates, appended after the drawer. */
  templates?: string;
}

/** The header's meta line: the given items, then the export time and the theme toggle. */
export const metaLine = (items: (string | false | undefined)[]) =>
  [...items, `<span>exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</span>`, `<button class="theme-toggle" type="button" aria-label="Toggle light and dark theme">theme</button>`]
    .filter(Boolean)
    .join("");

export async function pageHtml(p: Page): Promise<string> {
  const read = (file: string) => Bun.file(join(import.meta.dir, file)).text();
  const [css, js] = await Promise.all([read("page.css"), read("page.js")]);
  const tocList = (name: string, entries: TocEntry[], hidden: boolean) =>
    `<div class="toc-list" data-toc="${esc(name)}"${hidden ? " hidden" : ""}>${entries.map((t) => `<a href="#${esc(t.id)}" style="--depth:${t.depth}"${t.tip ? ` title="${esc(t.tip)}"` : ""}>${esc(t.title)}</a>`).join("")}</div>`;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="diffdeck (${esc(p.source)})">
<title>${esc(p.title)}</title>
<script>(() => { let t; try { t = localStorage.getItem("dd-theme"); } catch {} document.documentElement.dataset.theme = t || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); })();</script>
<style>${p.themeCss}
${css}</style>
</head>
<body${p.bodyAttrs}>
<nav class="toc" aria-label="Contents"><div class="toc-title">Contents<span class="toc-progress"></span></div>${tocList("walkthrough", p.toc, false)}${Object.entries(p.tabTocs ?? {}).map(([name, entries]) => tocList(name, entries, true)).join("")}</nav>
<main>
<header>${p.header}</header>
${p.main}
</main>
<aside class="drawer" aria-hidden="true"><button class="drawer-close" aria-label="Close">×</button><div class="drawer-body"></div></aside>
${p.templates ?? ""}
<script>${js}</script>
</body>
</html>
`;
}

/** What the Claude Code mod (mod/) shows for a page that waits for "Send to agent". */
export interface Waiting { label: string; kind: "colleague" | "self" | "drafts" }

/**
 * Write the page. Without `serve`, print its path. With `serve`, serve it and wait: the reader's
 * response is the only stdout, so an agent running this as a background job gets it as the job's
 * result. `detail` goes after the size in the "wrote" line.
 */
export async function deliver(html: string, outPath: string, o: { serve?: boolean; open?: boolean; detail?: string; waiting: Waiting }): Promise<void> {
  await Bun.write(outPath, html);
  console.error(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB${o.detail ?? ""})`);
  if (!o.serve) {
    console.log(outPath);
    if (o.open) Bun.spawnSync(["open", outPath]);
    return;
  }
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
  listWaiting(server.url.href, outPath, o.waiting);
  if (o.open) Bun.spawnSync(["open", server.url.href]);
}

// The diffdeck mod for Claude Code (mod/) shows pages that wait for "Send to agent" above the prompt.
// Each waiting server writes one <pid>.json here and removes it on exit.
function listWaiting(url: string, outPath: string, w: Waiting) {
  const dir = join(homedir(), ".local/state/diffdeck/serving");
  mkdirSync(dir, { recursive: true });
  // A server killed with SIGKILL can't remove its file; clear those here.
  for (const name of readdirSync(dir)) {
    const pid = Number(basename(name, ".json"));
    if (Number.isInteger(pid) && !isAlive(pid)) rmSync(join(dir, name), { force: true });
  }
  const file = join(dir, `${process.pid}.json`);
  const entry = { pid: process.pid, url, label: w.label, kind: w.kind, html: resolve(outPath), startedAt: new Date().toISOString() };
  // Write then rename, so the mod never reads a half-written file.
  writeFileSync(`${file}.tmp`, JSON.stringify(entry));
  renameSync(`${file}.tmp`, file);
  process.on("exit", () => rmSync(file, { force: true }));
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) process.on(signal, () => process.exit(code));
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
