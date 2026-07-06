# Roadbump reports

Short postmortems of things that **fought back** — a dependency bump that took
six wrong turns, a CI gate that behaved unexpectedly, a build that broke for a
non-obvious reason. Each report captures the *story* the one-line changelog
throws away: what I tried, why it failed, the actual root cause, and the reusable
lesson.

These are distinct from the two other logs:

- **[`../tooling.md`](../tooling.md) decisions log** — the terse "what we decided
  and why," one paragraph. A report is the long form behind an entry.
- **[`../backlog.md`](../backlog.md)** — forward-looking work not yet done.

## When to write one

When something cost real time or hid a non-obvious cause worth not re-learning.
Not every fix earns a report — a clean bump doesn't. If future-me (or an AI
pairing with me) would save an hour by reading it, write it.

## How

Copy [`TEMPLATE_REPORT.md`](TEMPLATE_REPORT.md) to `YYYY-MM-DD-short-slug.md`
(date = when it happened), fill it in, delete the guidance comments, and add a
row below.

## Reports

| Date | Report | Area | One-liner |
| --- | --- | --- | --- |
| 2026-07-06 | [vite audit-gate peer-dep](2026-07-06-vite-audit-gate-peer-dep.md) | deps / CI | pnpm `overrides` don't move an auto-installed peer — declare it as a direct dep |
