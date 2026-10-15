/**
 * Walkthrough document: a hand- or agent-written JSON file of typed blocks, with code
 * ranges pinned to the base and head commits of a git checkout.
 *
 * Validation is per block so errors name the exact block path and field, which
 * is what an agent needs to fix a file it wrote.
 */
import { z } from "zod";

const side = z.enum(["base", "head"]);
const line = z.int().positive();
export const sourceRange = z
  .object({
    file: z.string().min(1),
    start: z.object({ side, line }),
    end: z.object({ side, line }),
  })
  .refine((s) => s.start.side === s.end.side, "start.side and end.side must match")
  .refine((s) => s.end.line >= s.start.line, "end.line must be >= start.line");

const flowEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).optional(),
});
const unsupportedField = (what: string) => z.undefined({ error: `${what} is not supported by diffdeck; remove it` }).optional();
const flowNode = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(["process", "decision", "terminal"]).optional(),
  attachments: z.array(z.object({ label: z.string().optional(), sources: z.array(sourceRange) })).optional(),
  link: unsupportedField("flow_node.link"),
});
const frame = z.object({
  key: z.string().min(1),
  parentKey: z.string().optional(),
  label: z.string().min(1),
  source: sourceRange.optional(),
});
const step = z.object({
  id: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(["call", "return", "async"]).optional(),
  explanation: z.string().optional(),
  source: sourceRange.optional(),
  code: unsupportedField("step.code"),
});

const id = z.string().optional();
const blocks = {
  section: z.object({ type: z.literal("section"), id, title: z.string().min(1), children: z.array(z.unknown()) }),
  // markdown.pins would resolve its links at other commits; diffdeck reads code at the document pins only.
  markdown: z.object({ type: z.literal("markdown"), id, markdown: z.string(), pins: unsupportedField("markdown.pins") }),
  code_peek: z.object({ type: z.literal("code_peek"), id, source: sourceRange, caption: z.string().optional() }),
  flow_diagram: z.object({
    type: z.literal("flow_diagram"),
    id,
    title: z.string().optional(),
    description: z.string().optional(),
    direction: z.enum(["down", "right"]).optional(),
    nodes: z.array(flowNode).min(1),
    edges: z.array(flowEdge),
  }),
  call_stack_diff: z.object({
    type: z.literal("call_stack_diff"),
    id,
    title: z.string().optional(),
    base: z.array(frame),
    head: z.array(frame),
  }),
  sequence: z.object({
    type: z.literal("sequence"),
    id,
    title: z.string().optional(),
    actors: z.record(z.string(), z.string()),
    steps: z.array(step).min(1),
  }),
  divider: z.object({ type: z.literal("divider"), id }),
  // A slice of the PR diff inside a chapter: the changed files matching these paths or globs.
  diff: z.object({ type: z.literal("diff"), id, files: z.array(z.string().min(1)).min(1), caption: z.string().optional() }),
};

export type SourceRange = z.infer<typeof sourceRange>;
export type FlowNode = z.infer<typeof flowNode>;
export type Frame = z.infer<typeof frame>;
export type Step = z.infer<typeof step>;
type KnownBlock = { [K in keyof typeof blocks]: z.infer<(typeof blocks)[K]> }[keyof typeof blocks];
export type Block =
  | (Exclude<KnownBlock, { type: "section" }>)
  | (z.infer<typeof blocks.section> & { children: Block[] });

export const GITHUB_PR_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/;

/** Fields every review item shares: one anchor line at head, markdown text, optional grouping and link. */
const reviewItem = z.object({
  id: z.string().regex(/^[\w-]+$/, "letters, digits, _ and - only"),
  path: z.string().min(1),
  line: z.int().positive(),
  body: z.string().min(1),
  theme: z.string().optional(),
  // A walkthrough block id; the card links to it.
  relates_to: z.string().optional(),
});
/** A comment for a colleague's PR. Posts to the head side of the PR diff only. */
const reviewComment = reviewItem.extend({
  side: z.literal("RIGHT").default("RIGHT"),
  post: z.boolean().default(true),
});
/**
 * A finding on the user's own PR. `decision` is the agent's proposal; the user confirms or changes it.
 * `target` says what it's about: a code line (path + line) or the PR body (no anchor). `change`
 * shows the exact edit: `current` quotes the text as it is now (verbatim), `proposed` replaces it.
 * Without `current`, `proposed` is new text to add.
 */
const selfFinding = reviewItem
  .omit({ path: true, line: true })
  .extend({
    target: z.enum(["code", "pr_body"]).default("code"),
    path: z.string().min(1).optional(),
    line: z.int().positive().optional(),
    change: z.object({ current: z.string().min(1).optional(), proposed: z.string().min(1) }).optional(),
    decision: z.enum(["fix", "skip", "discuss"]).default("fix"),
    // One or two sentences: why this decision was proposed (behaviour, risk, churn, an earlier decision).
    why: z.string().min(1).optional(),
  })
  .superRefine((f, ctx) => {
    const at = (msg: string) => ctx.addIssue({ code: "custom", message: `(${f.id}) ${msg}` });
    if (f.target === "code" && (f.path === undefined || f.line === undefined)) at('a "code" finding needs path and line; use target "pr_body" for the PR description');
    if (f.target === "pr_body" && (f.path !== undefined || f.line !== undefined)) at('a "pr_body" finding has no path or line; quote the text in change.current instead');
    if (f.target === "pr_body" && f.decision === "fix" && !f.change) at('a "pr_body" fix needs change.proposed: the drafted text the user reviews and can edit');
  });
const colleagueReview = z.object({
  kind: z.literal("colleague"),
  // Markdown, read-only on the page: a short summary of the internal review report.
  verdict: z.string().optional(),
  body: z.string(),
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]).default("COMMENT"),
  comments: z.array(reviewComment),
  // Markdown items kept in the internal report, not posted.
  held_out: z.array(z.string()).optional(),
  // Set once the review is live. The page turns read-only and --payload refuses to run.
  posted: z
    .object({
      review_id: z.int().positive(),
      url: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+#pullrequestreview-\d+$/, "must be the review's html_url"),
      commit_id: z.string().regex(/^[0-9a-f]{40}$/, "must be the full commit SHA the review is pinned to"),
    })
    .optional(),
});
const selfReview = z.object({
  kind: z.literal("self"),
  verdict: z.string().optional(),
  findings: z.array(selfFinding),
  held_out: z.array(z.string()).optional(),
});
// `kind` defaults to "colleague", so review JSON written before self-reviews existed still parses.
export const review = z.preprocess(
  (v) => (v && typeof v === "object" && !("kind" in v) ? { ...v, kind: "colleague" } : v),
  z.discriminatedUnion("kind", [colleagueReview, selfReview]),
);
export type Review = z.infer<typeof review>;
export type ColleagueReview = z.infer<typeof colleagueReview>;
export type SelfReview = z.infer<typeof selfReview>;
export type ReviewItem = z.infer<typeof reviewItem>;
export type ReviewComment = z.infer<typeof reviewComment>;
export type SelfFinding = z.infer<typeof selfFinding>;
export const walkthrough = z.object({
  title: z.string().min(1),
  pins: z.object({ head: z.string().min(1), base: z.string().min(1).optional() }),
  origin: z.object({ branch: z.string().optional() }).optional(),
  // The PR this walkthrough explains. Found from origin.branch with gh when omitted.
  pr: z.object({ url: z.string().regex(GITHUB_PR_URL, "must be https://github.com/<owner>/<repo>/pull/<number>") }).optional(),
  // GitHub "owner/repo" that bare #123 mentions point at. Defaults to the PR's repo, then the checkout's origin remote.
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/repo"').optional(),
  document: z.array(z.unknown()).min(1),
  review: review.optional(),
  // A Diff tab with the whole base → head patch. `exclude` takes git globs (e.g. "**/pnpm-lock.yaml").
  diff: z.union([z.literal(true), z.object({ exclude: z.array(z.string().min(1)).default([]) })]).optional(),
});
export type Walkthrough = Omit<z.infer<typeof walkthrough>, "document"> & { document: Block[] };

const isKnown = (type: string): type is keyof typeof blocks => Object.hasOwn(blocks, type);

/** Parse a walkthrough; returns every problem found, each prefixed with its JSON path. */
export function parseWalkthrough(input: unknown): { doc?: Walkthrough; problems: string[] } {
  const problems: string[] = [];
  const top = walkthrough.safeParse(input);
  if (!top.success) return { problems: top.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };

  const parseBlocks = (raw: unknown[], path: string): Block[] =>
    raw.flatMap((value, i): Block[] => {
      const at = `${path}[${i}]`;
      const type = z.object({ type: z.string() }).safeParse(value);
      if (!type.success) {
        problems.push(`${at}: block needs a string "type"`);
        return [];
      }
      if (!isKnown(type.data.type)) {
        problems.push(`${at}: unsupported type "${type.data.type}" (supported: ${Object.keys(blocks).join(", ")})`);
        return [];
      }
      const parsed = blocks[type.data.type].safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) problems.push(`${at}.${issue.path.join(".")}: ${issue.message}`);
        return [];
      }
      const block = parsed.data;
      if (block.type === "section") return [{ ...block, children: parseBlocks(block.children, `${at}.children`) }];
      checkReferences(block, at, problems);
      return [block];
    });

  const document = parseBlocks(top.data.document, "document");
  if (top.data.review) checkReview(top.data.review, document, problems);
  return { doc: problems.length ? undefined : { ...top.data, document }, problems };
}

/** Keys that diagrams use to point at their own nodes, frames and actors must resolve. */
function checkReferences(block: KnownBlock, at: string, problems: string[]): void {
  if (block.type === "flow_diagram") {
    const keys = new Set(block.nodes.map((n) => n.key));
    block.edges.forEach((e, i) => {
      for (const end of ["from", "to"] as const)
        if (!keys.has(e[end])) problems.push(`${at}.edges[${i}].${end}: no node with key "${e[end]}"`);
    });
  }
  if (block.type === "call_stack_diff") {
    for (const sideName of ["base", "head"] as const) {
      const keys = new Set(block[sideName].map((f) => f.key));
      block[sideName].forEach((f, i) => {
        if (f.parentKey && !keys.has(f.parentKey)) problems.push(`${at}.${sideName}[${i}].parentKey: no frame with key "${f.parentKey}"`);
      });
    }
  }
  if (block.type === "sequence") {
    block.steps.forEach((s, i) => {
      for (const end of ["from", "to"] as const)
        if (!Object.hasOwn(block.actors, s[end])) problems.push(`${at}.steps[${i}].${end}: no actor "${s[end]}"`);
    });
  }
}

function checkReview(r: Review, document: Block[], problems: string[]): void {
  const blockIds = new Set<string>();
  const walk = (nodes: Block[]) => {
    for (const n of nodes) {
      if (n.id) blockIds.add(n.id);
      if (n.type === "section") walk(n.children);
    }
  };
  walk(document);
  const seen = new Set<string>();
  const key = r.kind === "self" ? "findings" : "comments";
  (r.kind === "self" ? r.findings : r.comments).forEach((c, i) => {
    if (seen.has(c.id)) problems.push(`review.${key}[${i}].id: duplicate id "${c.id}"`);
    seen.add(c.id);
    if (c.relates_to && !blockIds.has(c.relates_to)) problems.push(`review.${key}[${i}].relates_to: no block has id "${c.relates_to}"`);
  });
}
