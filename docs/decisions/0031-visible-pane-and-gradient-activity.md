# 0031: Visible pane and gradient activity

> Purpose: keep automatic diffs from covering JEI and replace flat activity rows with a shared directional sheen · Status: current · Last reviewed: 2026-10-22

Status: accepted

Date: 2026-10-22

## Context

Claude opens its diff pane automatically after the first successful edit. That can cover JEI's Files, Search or Git view. The activity row also uses one flat color and an explicit underline across padded selected names, which looks like a solid stripe rather than motion along the file.

## Decision

While JEI is placed and shown, answer automatic `ui.open` requests for the built-in `cc-plugin-diff` plugin's `diff` pane as unplaced. Pane IDs are namespaced, so check both the opener's name and built-in tier; other plugins' `diff` panes pass through. An explicit `/diff` dispatch passes through; other pane IDs and a closed/hidden JEI are left alone. Do not close or reopen JEI after every tool call, change its tab or keyboard ownership, or write host preferences. Only pane inspection errors are caught: failed opens are never retried. OpenCode has no competing first-edit diff opener to suppress.

Both Files adapters draw a shared left-to-right gradient over the activity-colored label. One 1.2-second sweep has eight intensity levels and a 60 ms redraw period; trailing padding does not stretch the sweep. Segment text at grapheme boundaries. Purple/read, orange/write and green/Git retain their meanings, with pale gradient crests for dark themes and deeper crests for light themes. Claude reads its theme through the read-only config API, caching until session entry or a successful theme change; ordinary text keeps host theme tokens.

Remove JEI's explicit underline from active selected names; keep bold text and the host's native focus indicator. The status letter stays separate. Ancestor tints remain softer and steady. Active counts, activity filtering, independent followAgent navigation, the two-second completion fade and session gutter marker from ADR 0030 remain. Build gradient runs only for visible rows and stop the shared timer when nothing glows. No runtime dependency or persisted option is added.

This supersedes ADR 0030's flat selected-name treatment, not its input, activity lifecycle or recovery rules.

## Verification

Replay the registered native pane-opening boundary, including automatic/manual diff, other panes and closed JEI. Native kit and real OpenTUI renderers cover moving gradient stops, selection, separate status colors, softer ancestors, expiration and 24/40/80/120 columns in light/dark themes. Shared tests prove left-to-right travel and intact wide/combining graphemes. A bounded live Claude pass verifies that create/edit retain Files, Search and Git and explicit `/diff` still opens, without asking the model to work.
