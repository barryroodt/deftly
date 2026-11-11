// diffdeck mod: a band above the prompt for diffdeck pages that wait for "Send to agent", and
// /diffdeck-pages, a pane that opens waiting and recent pages.
// `diffdeck --serve` writes one <pid>.json per waiting page to ~/.local/state/diffdeck/serving and
// removes it on exit (see listWaiting in ../../scripts/diffdeck.ts).

import type { EngineInterface, On } from "claude-code";

const PANE = "diffdeck-pages";
const RECENT = 12;

interface Waiting { pid: number; url: string; label: string; kind: "colleague" | "self" | "drafts"; html: string; startedAt: string }
const KIND_LABEL: Record<Waiting["kind"], string> = { colleague: "review", self: "self-review", drafts: "drafts" };
interface Page { name: string; path: string; mtimeMs: number }

let home = "";
let waiting: Waiting[] = [];
let recent: Page[] = [];

export function register(on: On) {
  on("session.start", async ($, e, next) => {
    home = (await $.env.get("HOME")) ?? "";
    await $.command.register({ name: PANE, description: "Open a waiting or recent diffdeck page" });
    // Claude Code waits for session.start before the first prompt, so poll in the background.
    void refreshWaiting($);
    $.clock.every(2000, () => refreshWaiting($));
    return next(e);
  });

  on("command.run", { command: PANE }, async ($) => {
    await refreshWaiting($);
    recent = await recentPages($);
    await $.ui.open({ id: PANE, title: "diffdeck", focus: true, closeOnEscape: true });
    return {};
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!waiting.length) return next(e);
    const { Box, Text, Link } = $.ui.resolve(e);
    // Link draws as a clickable OSC 8 span, or as its text then the URL where the terminal has none.
    const rows = waiting.map((w) =>
      Box({
        key: `waiting-${w.pid}`,
        children: [Text({ children: [`diffdeck · ${w.label} · ${KIND_LABEL[w.kind]} waiting for Send to agent · `, Link({ href: w.url, label: "open page" })] })],
      }),
    );
    return Box({ flexDirection: "column", children: [...rows, await next(e)] });
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    // Digits 1–9 press the first nine rows (a plain button shows its hotkey); Tab and Enter reach the rest.
    // The age goes first at a fixed width, so long page names wrap without pushing it around.
    let n = 0;
    const row = (key: string, label: string, detail: string, target: string) => {
      n += 1;
      return Box({
        key,
        flexDirection: "row",
        children: [
          Box({ width: 9, flexShrink: 0, children: [Text({ dimColor: true, children: [detail] })] }),
          Button({
            key: `open-${key}`,
            label,
            ...(n <= 9 ? { hotkey: String(n) } : {}),
            plain: true,
            onPress: async () => {
              await $.process.run(["open", target]);
              await $.ui.close({ id: PANE });
            },
          }),
        ],
      });
    };
    const now = Date.now();
    return Box({
      flexDirection: "column",
      children: [
        Text({ bold: true, children: ["Waiting for Send to agent"] }),
        ...(waiting.length
          ? waiting.map((w) => row(`w${w.pid}`, `${w.label} (${KIND_LABEL[w.kind]})`, ago(now, Date.parse(w.startedAt)), w.url))
          : [Text({ dimColor: true, children: ["none"] })]),
        Text({ children: [" "] }),
        Text({ bold: true, children: [`Recent pages in ~/diffdeck`] }),
        ...(recent.length
          ? recent.map((p) => row(`r${p.name}`, p.name.replace(/\.html$/, ""), ago(now, p.mtimeMs), p.path))
          : [Text({ dimColor: true, children: ["none"] })]),
      ],
    });
  });
}

async function refreshWaiting($: EngineInterface) {
  const dir = `${home}/.local/state/diffdeck/serving`;
  const found: Waiting[] = [];
  if (await $.fs.exists(dir)) {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      try {
        const w = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Waiting;
        // A server killed with SIGKILL leaves its file behind, so check the process is still there.
        if ((await $.process.run(["kill", "-0", String(w.pid)])).exitCode === 0) found.push(w);
      } catch {
        // Removed between list and read: the next poll settles it.
      }
    }
  }
  found.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (JSON.stringify(found) === JSON.stringify(waiting)) return;
  waiting = found;
  $.ui.invalidate("ui.render");
}

async function recentPages($: EngineInterface) {
  const dir = `${home}/diffdeck`;
  if (!(await $.fs.exists(dir))) return [];
  const pages: Page[] = [];
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind === "file" && entry.name.endsWith(".html")) pages.push({ name: entry.name, path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs });
  }
  return pages.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT);
}

function ago(now: number, then: number) {
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
