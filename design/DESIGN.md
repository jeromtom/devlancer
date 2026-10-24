# Devlancer design system

Devlancer is a ghost freelance dev on the freelancer's own WhatsApp. It finds gigs, pitches, sends proposals and invoices, and hands the engineering to Devin. The dashboard is where the freelancer checks in: what came in, what Devin is building, and what money is owed. It is an operating surface, so clarity beats expression, and the brand shows up in precise details.

## Brand

**Mark.** Three hexagon cells in the original Devin colours, set as a forward chevron: blue (the gig comes in), green (the money comes back) and cyan (Devin builds it). Files: `brand/mark.svg`, `brand/lockup.svg`.

**The hex cell is the one motif.** It appears only where it carries meaning: pipeline stage markers, KPI keys, client avatars, and the Devin nav icon. No decorative hex patterns, gradients or background textures.

**Voice.** Plain, warm, specific. Say what Devlancer did ("Pitched privately to Dr Meera"), not what the system is ("lead status updated"). Sentence case everywhere. Empty states tell the freelancer what will appear and what to do next.

## Colour carries meaning

| Token | Hex | Means |
|---|---|---|
| `--hex-blue` | #3B63D1 | Gigs, pitches, proposals; primary buttons |
| `--hex-cyan` | #0B96DC | Devin, building, live previews; active nav marker |
| `--hex-green` | #1DB98F | Money in, paid, Devlancer covering |
| `--amber` | #E39B27 | Money waiting, queued for the freelancer |
| `--coral` | #E0524C | Overdue, blocked, failed, needs attention |
| `--night` | #0E1630 | Sidebar |
| `--ink` / `--ink-2` / `--ink-3` | #172036 / #4A5470 / #8590A6 | Text tiers |
| `--canvas` / `--surface` / `--line` | #F4F6FA / #FFFFFF / #E1E6EF | Background, panels, borders |

Each colour has an `-ink` variant for text on white (4.5:1 or better) and a `-wash` for chip and icon backgrounds. The pipeline reads left to right through the same families: blue (gig, pitched, proposal), cyan (building, live), amber (invoiced), green (paid).

## Type

- **Bricolage Grotesque** 600/700: page titles, KPI values, pipeline counts, wordmark. Tight tracking (-0.02em).
- **IBM Plex Sans** 400/500/600: everything else. Tabular figures for money in tables.
- Scale: 12, 13, 14 (base), 16, 20, 24, 32.

## Layout

- Collapsible sidebar: 248px expanded, 68px rail. It remembers the choice and toggles with `[`. Below 860px it becomes an off-canvas drawer.
- Sidebar groups: Work (Overview, Pipeline, Projects), Automation (Devin sessions, Activity), Money (Invoices), with Connections pinned to the foot. Count badges: neutral for volume, cyan for live work, coral for things that need the freelancer. Only cyan and coral survive in the rail.
- Content max width 1480px, 32px gutters, 20px between panels.
- Radius follows hierarchy: chips 6, controls 8, panels 12.
- KPIs sit in one divided panel, not a row of identical cards.

## Motion

Only in response to change: a stage-change ring on a deal that moved, a cyan wash on a fresh activity row, and the green presence pulse while Devlancer is covering. All motion is off under `prefers-reduced-motion`.

## Files

- `tokens.css`: all tokens. `fonts.css` and `fonts/`: self-hosted type. `components.css`: dashboard components and shell.
- `cards/`: Claude Design preview cards.
- The dashboard (`web/`) loads these files directly, so this folder is the source of truth.
