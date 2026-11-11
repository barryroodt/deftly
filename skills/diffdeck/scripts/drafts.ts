/**
 * A drafts deck: several drafts for other people (a Linear issue, a Slack reply, an email), each
 * editable in the browser, with a per-draft choice of who posts it. The reader sends the result
 * back with Respond; that is never approval to post. diffdeck itself posts nothing, and this page
 * reads no git and no gh.
 */
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { deliver, esc, metaLine, pageHtml } from "./serve.ts";
import { loadTheme } from "./theme.ts";

interface ChannelSpec { label: string; title?: string; titleRequired?: boolean }
/** Each channel's label and its title field. A channel without `title` has a body only. */
const CHANNELS = {
  linear_issue: { label: "Linear issue", title: "Title", titleRequired: true },
  linear_comment: { label: "Linear comment" },
  slack_message: { label: "Slack message" },
  slack_reply: { label: "Slack reply" },
  email: { label: "Email", title: "Subject", titleRequired: true },
  email_reply: { label: "Email reply", title: "Subject" },
  github_comment: { label: "GitHub comment" },
  text: { label: "Text", title: "Title" },
} as const satisfies Record<string, ChannelSpec>;
type Channel = keyof typeof CHANNELS;

const DECISIONS = [
  ["post", "Agent posts (asks me first)"],
  ["manual", "I'll post it"],
  ["hold", "Hold"],
] as const;

const draft = z
  .strictObject({
    id: z.string().regex(/^[\w-]+$/, "letters, digits, _ and - only"),
    channel: z.enum(Object.keys(CHANNELS) as [Channel, ...Channel[]]),
    /** Where it goes, shown as chips: { team: "AI" }, { thread: "https://…" }, { to: ["a@b.c"] }. */
    to: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    /** The message being answered, shown read-only as plain text. */
    context: z.string().optional(),
    title: z.string().optional(),
    body: z.string().min(1),
    /** The agent's proposal; the reader can change it. */
    decision: z.enum(["post", "manual", "hold"]).default("post"),
    why: z.string().optional(),
    /** Set after the draft went out; the card turns read-only. */
    posted: z.strictObject({ at: z.string().min(1), url: z.url({ protocol: /^https?$/ }).optional() }).optional(),
  })
  .superRefine((d, ctx) => {
    const spec: ChannelSpec = CHANNELS[d.channel];
    if (d.title !== undefined && !spec.title) ctx.addIssue({ code: "custom", path: ["title"], message: `a ${d.channel} has no title; put everything in body` });
    if (spec.titleRequired && !d.title) ctx.addIssue({ code: "custom", path: ["title"], message: `a ${d.channel} needs a ${spec.title!.toLowerCase()}` });
  });
type Draft = z.infer<typeof draft>;

const drafts = z
  .strictObject({ kind: z.literal("drafts"), title: z.string().min(1), drafts: z.array(draft).min(1) })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.drafts.forEach((d, i) => {
      if (seen.has(d.id)) ctx.addIssue({ code: "custom", path: ["drafts", i, "id"], message: `duplicate id "${d.id}"` });
      seen.add(d.id);
    });
  });

const linkOrText = (v: string) => (/^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v));

function card(d: Draft, n: number): string {
  const spec: ChannelSpec = CHANNELS[d.channel];
  const live = !!d.posted;
  const ro = live ? " readonly" : "";
  const to = Object.entries(d.to ?? {})
    .map(([k, v]) => `<span class="dr-chip"><span>${esc(k)}</span> ${(Array.isArray(v) ? v : [v]).map(linkOrText).join(", ")}</span>`)
    .join("");
  const copy = (field: string, label: string) => `<button type="button" class="sr-edit dr-copy" data-copy-field="${esc(`${d.id}.${field}`)}">${label}</button>`;
  const status = live
    ? `<span class="rv-status posted">${d.posted!.url ? `<a href="${esc(d.posted!.url)}" target="_blank" rel="noopener">Posted ↗</a>` : "Posted"}</span>`
    : `<span class="rv-status">Not posted</span>`;
  return `<article class="rv-card sr-card dr-card" id="${esc(d.id)}" data-key="${esc(d.id)}" data-decision="${live ? "posted" : d.decision}">
    <header class="rv-head"><span class="rv-post"><b>${n}</b> · <span class="pill sr-target">${esc(spec.label)}</span></span>
      <span class="rv-flag" hidden>edited</span><button type="button" class="rv-revert" hidden>Revert</button>${status}</header>
    ${to ? `<div class="dr-to">${to}</div>` : ""}
    ${d.context ? `<details class="dr-context"><summary>Replying to</summary><div class="dr-context-text">${esc(d.context)}</div></details>` : ""}
    ${spec.title ? `<label class="dr-label">${esc(spec.title)} ${copy("title", "Copy")}</label><input class="dr-title" data-field="${esc(`${d.id}.title`)}" value="${esc(d.title ?? "")}" spellcheck="true"${ro}>` : ""}
    <label class="dr-label">${spec.title ? "Body" : "Message"} ${copy("body", "Copy")}</label>
    <textarea class="rv-text dr-body" data-field="${esc(`${d.id}.body`)}" spellcheck="true"${ro}>${esc(d.body)}</textarea>
    ${
      live
        ? ""
        : `<div class="sr-decide">${DECISIONS.map(([v, label]) => `<label><input type="radio" name="dr-${esc(d.id)}" data-decision="${esc(d.id)}" value="${v}"${d.decision === v ? " checked" : ""}> ${label}${d.decision === v ? ` <small>proposed</small>` : ""}</label>`).join("")}
      ${d.why ? `<div class="sr-why"><b>Why:</b> ${esc(d.why)}</div>` : ""}</div>
    <textarea class="sr-note" data-note="${esc(d.id)}" rows="1" placeholder="Note for the agent (optional), e.g. post after Friday's standup"></textarea>`
    }
  </article>`;
}

export async function runDrafts(raw: unknown, input: string, values: { out?: string; open?: boolean; serve?: boolean; theme?: string }, fail: (lines: string[], hint: string) => never): Promise<never> {
  const parsed = drafts.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`), `${parsed.error.issues.length} problem(s) in the drafts; nothing written.`);
  const doc = parsed.data!;
  const theme = await loadTheme(values.theme);
  if (theme.problems.length) fail(theme.problems, `The theme at ${theme.path} can't be used; nothing written.`);
  const open = doc.drafts.filter((d) => !d.posted);
  if (values.serve && !open.length) fail(["--serve"], "Every draft is already posted, so the page has nothing to send.");

  const label = (d: Draft) => {
    const spec: ChannelSpec = CHANNELS[d.channel];
    const what = d.title ?? d.body.split("\n")[0]!;
    return `${spec.label}: ${what.length > 48 ? `${what.slice(0, 47)}…` : what}`;
  };
  // page.js builds the response from these: the original text of every open draft and its proposal.
  const data = { kind: "drafts", title: doc.title, drafts: open.map((d) => ({ id: d.id, n: doc.drafts.indexOf(d) + 1, label: label(d), title: d.title, body: d.body, decision: d.decision })) };
  const count = (v: string) => open.filter((d) => d.decision === v).length;
  const main = `<div class="review drafts">
    <h2>Drafts <span class="rv-count">${doc.drafts.length} · proposed ${count("post")} for the agent, ${count("manual")} for you, ${count("hold")} on hold${open.length < doc.drafts.length ? ` · ${doc.drafts.length - open.length} posted` : ""}</span></h2>
    <p class="rv-note">Edit freely; edits save in this browser. Respond sends your choices back. It is not approval to post: the agent asks you before posting anything.</p>
    ${doc.drafts.map((d, i) => card(d, i + 1)).join("\n")}
    ${open.length ? `<div class="rv-bar"><button type="button" class="rv-respond">Respond</button></div>
    <script type="application/json" id="drafts-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>` : ""}
  </div>`;

  const html = await pageHtml({
    title: doc.title,
    source: basename(input),
    themeCss: theme.css,
    // A new round (changed drafts) starts with fresh edits; the same round keeps them across reloads.
    bodyAttrs: ` data-doc-key="${esc(`dd-drafts-doc:${doc.title}`)}" data-drafts-key="${esc(`dd-drafts:${doc.title}:${Bun.hash(JSON.stringify(doc.drafts)).toString(36)}`)}"`,
    toc: doc.drafts.map((d, i) => ({ id: d.id, title: `${i + 1} · ${label(d)}`, depth: 0 })),
    header: `<h1>${esc(doc.title)}</h1><div class="meta">${metaLine([`<span>${doc.drafts.length} draft${doc.drafts.length === 1 ? "" : "s"}</span>`])}</div>`,
    main,
  });
  const outPath = values.out ?? join(dirname(input), `${basename(input, ".json")}.html`);
  await deliver(html, outPath, { serve: values.serve, open: values.open, waiting: { label: doc.title, kind: "drafts" } });
  if (!values.serve) process.exit(0);
  // The server keeps the process alive and exits it after "Send to agent"; never return to the walkthrough path.
  return new Promise<never>(() => {});
}
