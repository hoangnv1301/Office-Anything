# the-wall.svg, superseded 2026-09-01

Replaced by `assets/the-office.svg`.

**Why it went.** It illustrated the send wall, which is a safety feature rather than the
reason anybody would want this. The replacement shows what the project is actually for: one
Claude Code conversation becoming a team of desks, with what each may reach as the
consequence rather than the point.

**It was also broken.** A CSS class set `fill` on a path carrying `fill="none"` as a
presentation attribute. CSS wins that, so the curve rendered as a solid red blob rather than
a dashed line. Kept here because that failure is worth being able to look at: the SVG is
valid, the intent is legible in the source, and it still renders wrongly.

Nothing references it. Retired rather than deleted, because a deletion is the one mistake
with no undo.
