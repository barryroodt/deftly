# Setting up a custom theme

Use this when the user wants diffdeck pages in their own design system. The result is a folder, `~/.config/diffdeck/theme/`, holding a `theme.css` and any font files it uses. diffdeck picks it up on every render; `--theme <dir>` overrides it for one render.

## The contract

`theme.css` must define every variable below, under both `[data-theme='light']` and `[data-theme='dark']` (fonts and radius can sit in `:root`). diffdeck refuses to render with a theme that leaves one out and lists what's missing. `scripts/themes/default/theme.css` is a complete example to copy from.

| Variable | Used for |
|---|---|
| `--background` | Page background; also text on `--primary` buttons |
| `--card` | Code blocks, diagrams, diff files |
| `--popover` | Drawer, dialogs, sticky file headers |
| `--secondary` | Hunk headers, secondary buttons |
| `--muted` | Inline code background |
| `--accent` | Hover and active rows in the contents |
| `--foreground` | Body text and headings |
| `--muted-foreground` | Prose, secondary text |
| `--tertiary-foreground` | Labels, line numbers, hints |
| `--border` | Every border and divider |
| `--input` | Form and pill borders |
| `--ring` | Keyboard focus outline |
| `--primary` | Links, the brand accent, primary buttons, added lines |
| `--border-brand` | Border next to `--primary` (PR pills, link underlines) |
| `--warning` / `--border-warning` | Warnings, "discuss" findings |
| `--destructive` / `--border-destructive` | Removed lines, errors |
| `--info` / `--border-info` | Merged-PR state |
| `--code-foreground` | Plain code text |
| `--code-token-comment`, `-keyword`, `-function`, `-string`, `-string-expression`, `-number`, `-constant`, `-property`, `-parameter`, `-punctuation`, `-link` | Syntax highlighting |
| `--dd-font-sans` / `--dd-font-mono` | Font stacks |
| `--dd-radius` | Corner radius |

Any CSS colour works, including `var(--their-token)` references and `oklch(…)`. The page derives tints itself (e.g. `oklch(from var(--primary) l c h / 12%)` for added lines), so don't define those.

## Procedure

1. **Find the source.** Ask where the design system's tokens live: a repo or package (CSS variables, Tailwind config, a tokens JSON file) or a docs page. Prefer files over screenshots. Note the version or commit you copy from.
2. **Copy, then map.** Put their token files in `theme.css` unchanged when they're CSS, so a later refresh is a straight copy. Then add a short mapping block that defines each contract variable in terms of their tokens, e.g. `--border-brand: var(--border-brand-default);`. Convert other formats (JSON, Tailwind) into plain CSS variables first. If their light and dark tokens use other selectors (`.dark`, `[data-mode]`), map them onto `[data-theme='light']` and `[data-theme='dark']`.
3. **Fonts.** Put the font files next to `theme.css` and reference them with relative `url(./font.woff2)` in `@font-face`; diffdeck inlines them so the HTML stays one file (`.woff2`, `.woff`, `.ttf`, `.otf`). Absolute `https:` URLs also work but need the network when the page opens. Only use fonts the user is licensed to embed; otherwise put a system fallback in the stack.
4. **Credit the source** in a comment at the top of `theme.css`: where the tokens and fonts came from, the commit or version, and their licences.
5. **Check it.** Render any walkthrough. Fix every `not defined` problem diffdeck reports. Open the page and toggle light and dark: text must be readable on every surface, added and removed lines must be distinguishable, and code must be highlighted. Show the user both modes and adjust the mapping until they're happy.

## Updating

To refresh the tokens, copy the newer files over the unchanged part of `theme.css`, update the commit in the top comment and render again; the mapping block normally survives. To go back to the default theme, delete `~/.config/diffdeck/theme/`.
