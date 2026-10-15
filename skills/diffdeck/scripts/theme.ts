/**
 * Themes. A theme is a folder with a `theme.css` that defines every variable in CONTRACT, for both
 * `[data-theme='light']` and `[data-theme='dark']`. The page inlines it, so relative `url()`s
 * (fonts, mostly) are inlined as data URLs and the HTML stays one self-contained file.
 *
 * Lookup: `--theme <dir>`, then ~/.config/diffdeck/theme/, then the built-in themes/default/.
 * The user's theme lives outside the skill folder, so reinstalling the skill never replaces it.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

/** Every variable page.css reads. A theme must define each one. */
export const CONTRACT = [
  // surfaces and text
  "--background", "--card", "--popover", "--secondary", "--muted", "--accent",
  "--foreground", "--muted-foreground", "--tertiary-foreground",
  // lines and focus
  "--border", "--input", "--ring",
  // intent colours, each with a matching border
  "--primary", "--border-brand", "--warning", "--border-warning",
  "--destructive", "--border-destructive", "--info", "--border-info",
  // code
  "--code-foreground", "--code-token-comment", "--code-token-keyword", "--code-token-function",
  "--code-token-string", "--code-token-string-expression", "--code-token-number", "--code-token-constant",
  "--code-token-property", "--code-token-parameter", "--code-token-punctuation", "--code-token-link",
  // type and shape
  "--dd-font-sans", "--dd-font-mono", "--dd-radius",
];

const MIME: Record<string, string> = {
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".svg": "image/svg+xml", ".png": "image/png",
};

export const USER_THEME = join(homedir(), ".config", "diffdeck", "theme");

export async function loadTheme(dir?: string): Promise<{ path: string; css: string; problems: string[] }> {
  const base = dir ? resolve(dir) : existsSync(join(USER_THEME, "theme.css")) ? USER_THEME : join(import.meta.dir, "themes", "default");
  const path = join(base, "theme.css");
  const file = Bun.file(path);
  if (!(await file.exists())) return { path, css: "", problems: [`${path}: no such file`] };
  let css = await file.text();
  const problems = CONTRACT.filter((name) => !new RegExp(`${name}\\s*:`).test(css)).map((name) => `${name}: not defined`);
  for (const m of new Set(css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g).map((m) => m[0]))) {
    const ref = /url\(\s*['"]?([^'")]+)/.exec(m)![1]!.trim();
    if (/^(data:|https?:|#)/.test(ref)) continue;
    const asset = Bun.file(resolve(base, ref));
    const type = MIME[extname(ref).toLowerCase()];
    if (!type) problems.push(`url(${ref}): unsupported file type (use ${Object.keys(MIME).join(", ")})`);
    else if (!(await asset.exists())) problems.push(`url(${ref}): no such file next to theme.css`);
    else css = css.replaceAll(m, `url(data:${type};base64,${Buffer.from(await asset.arrayBuffer()).toString("base64")})`);
  }
  return { path, css, problems };
}
