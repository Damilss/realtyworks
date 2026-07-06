<!--
  HOW TO USE THIS TEMPLATE
  1. Copy this file to  docs/reports/YYYY-MM-DD-short-slug.md
     (date = when the roadbump happened; slug = a few kebab-case words).
  2. Fill in every section. Delete the inline HTML-comment hints as you go.
  3. Delete THIS comment block.
  4. Add a row to docs/reports/README.md's index table.

  Write for yourself, in plain language — this is a note to future-you, not a
  status report. Keep the metadata table and headings intact so it's easy to
  scan (and easy for an AI pairing with you to parse). A report is worth writing
  when something *fought back*: real dead-ends, a non-obvious root cause, a
  lesson worth not re-learning. Not every fix needs one.
-->

# Report: <one-line title — what the roadbump was>

| | |
| --- | --- |
| **Date** | YYYY-MM-DD |
| **Area** | <deps / CI / build / runtime / tooling / …> |
| **Cost** | <rough time + how many dead-ends, e.g. "~1h, 6 dead-ends"> |
| **Status** | <Resolved / Workaround (still owe a real fix) / Open> |
| **Commits / PRs** | <hashes, #PRs — or "—"> |
| **Issues** | <#123 — or "—"> |
| **Tags** | <comma,separated,keywords for future search> |
| **See also** | <cross-links: other reports, `../a-doc.md#section`, external URLs> |

## TL;DR

<!-- 2–3 sentences: what broke → the root cause → the fix that worked. The
     whole point up front, so future-you gets the payoff without reading on. -->

## What I was doing

<!-- The goal that led here. Why were you touching this at all? One short para. -->

## The roadbump

<!-- The symptom. Paste the actual error / the surprising behaviour. What did
     you expect vs. what happened? -->

## What I tried (and why it didn't work)

<!-- The meat, and the part a one-line changelog throws away. List the attempts
     in order; for each, say what you expected and why it failed. This is what
     stops future-you (or an AI) from re-walking the same dead-ends. -->

1. **<attempt>** — <what happened / why it failed>
2. **<attempt>** — <…>

## Root cause

<!-- The real mechanism, in one clear paragraph. Not "it was flaky" — the actual
     reason. If you never fully nailed it, say so and note the best theory. -->

## The fix

<!-- What actually worked. Commands / diff / config. Then how you verified it
     (the check that proves it's really fixed, ideally the one CI runs). -->

```bash
# the command(s) / change that resolved it
```

## Lesson / next time

<!-- The reusable rule, stated so it transfers to the next case. Cross-link the
     relevant field-manual section; note if this *extends* or contradicts it. -->

> **Rule:** <the one-sentence takeaway you'd want flagged before you hit this again.>

## References

<!-- Commits, PRs, issues, docs, advisories, external links, changelog entries. -->

- <commit / PR / issue>
- <doc or external link>
