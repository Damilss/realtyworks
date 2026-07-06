# Report: pnpm `overrides` won't move an auto-installed peer (vite)

| | |
| --- | --- |
| **Date** | 2026-07-06 |
| **Area** | dependencies (pnpm) / CI |
| **Cost** | Long detour — ~7 dead-ends across `pnpm update` / `overrides` / `--force` / full lockfile regen before the fix, plus two slow from-scratch installs and one transient network abort |
| **Status** | Resolved |
| **Commits / PRs** | `3c32251` (`ci(audit): make the pnpm audit dependency gate blocking`) |
| **Issues** | #20 (audit gate) |
| **Tags** | pnpm, peer-dependencies, auto-install-peers, overrides, vite, vitest, audit, lockfile |
| **See also** | [`../dependency-version-management.md`](../dependency-version-management.md) §3.4–3.5 (this extends it) · [`../tooling.md`](../tooling.md) decisions log |

## TL;DR

I needed to bump `vite` (a dev-only, transitive **peer** of `vitest`) from
8.0.13 to ≥ 8.0.16 to clear a high advisory. Every "force a transitive version"
trick — `pnpm.overrides`, `pnpm update`, `--force`, even deleting the lockfile
and regenerating — left it stuck at 8.0.13. Root cause: **pnpm `overrides` do
not govern auto-installed peer dependencies.** The fix was to stop fighting the
peer machinery and declare `vite` as a **direct `devDependency`**, which pnpm
installs exactly (8.1.3).

## What I was doing

Flipping the CI `pnpm audit --audit-level=high` step from advisory-only to
**blocking** (issue #20). Before removing `continue-on-error`, the one
outstanding high advisory had to be cleared: **GHSA-fx2h-pf6j-xcff** — a
`server.fs.deny` bypass in `vite`, dev-only, pulled in transitively as a peer of
`vitest`, patched in `vite >= 8.0.16`. So: get vite off 8.0.13. Should be a
one-line lockfile bump. It was not.

## The roadbump

`vite` is nobody's direct dependency here — it's an **auto-installed peer** of
`vitest` (and of `@vitest/mocker`):

```
pnpm ls vite --depth Infinity
└─┬ vitest 4.1.6
  ├── vite 8.0.13 peer
  └─┬ @vitest/mocker 4.1.6
    └── vite 8.0.13 peer
```

Every attempt to move it either did nothing or made a mess, and the ones using
an override produced this tell-tale warning — the requirement changed, the
*resolved* version didn't:

```
✕ unmet peer vite@^8.0.16: found 8.0.13
```

## What I tried (and why it didn't work)

1. **`pnpm update vite --depth Infinity`** — didn't move vite (it's not a direct
   dep, so there's nothing to "update"), and as a bonus rewrote a pile of
   *unrelated* manifest ranges (`@types/node ^20 → ^20.19.41`, `eslint`,
   `typescript`, …) because `--depth Infinity` re-pins everything it touches.
   Reverted.
2. **`pnpm.overrides: { "vite": "^8.0.16" }` + `pnpm install`** — the override
   landed in the lockfile and rewrote the peer *requirement* to `^8.0.16`, but
   the resolved vite stayed `8.0.13` → "unmet peer" warning.
3. **`pnpm update vite`** (override present) — still 8.0.13, and re-polluted the
   manifest ranges again.
4. **`pnpm install --fix-lockfile`** (override present, manifest cleaned) — the
   flag literally exists to reconcile lockfile inconsistencies; it left vite at
   8.0.13.
5. **`pnpm install --force`** — full reinstall; still 8.0.13.
6. **Delete `pnpm-lock.yaml`, regenerate with no override** — a from-scratch
   resolve *reproduced* 8.0.13 (1-line churn). So this isn't lockfile staleness:
   pnpm deterministically resolves this auto-peer to 8.0.13.
7. **Add the override back, delete the lockfile, regenerate** — the one
   combination left. Still 8.0.13 + the "unmet peer" warning. That killed the
   override theory for good.

## Root cause

**pnpm `overrides` (and `pnpm update`) do not control the version of an
*auto-installed peer dependency*.** With `auto-install-peers` on (pnpm 9
default), pnpm satisfies `vitest`'s `vite` peer by installing vite itself. An
override rewrites the *declared requirement* — which is why the lockfile showed
`vite: ^8.0.16` and pnpm then complained the resolved 8.0.13 was an "unmet peer"
— but the peer installer keeps resolving the version it already picked. Deleting
the lockfile ruled out staleness: even a clean resolve lands on 8.0.13 (I didn't
fully chase *why that exact version* over the newer 8.1.x — there's no `.npmrc`
pinning resolution mode — but it's deterministic, and irrelevant once you stop
using the override). The override was simply the wrong tool for this shape of
dependency.

## The fix

Declare `vite` as a **direct `devDependency`**. A direct dep isn't routed
through the auto-peer resolver — pnpm installs exactly what's declared, and it
dedupes so `vitest`'s peer resolves to that same copy.

```bash
pnpm add -D "vite@^8.0.16"     # resolves to 8.1.3; dedupes with vitest's peer
```

`package.json` gains one line (`"vite": "^8.0.16"`), and the whole tree moves to
a single `vite@8.1.3`. Verified:

- `pnpm audit --audit-level=high` → **exit 0** (was exit 1 on the vite high).
- `lint` · `typecheck` · `test` (vitest still green under 8.1.3) · `build` all pass.
- `pnpm install --frozen-lockfile` consistent — CI won't fail on drift.

The ~230-line `pnpm-lock.yaml` churn is all of vite's *own* subtree
(`rolldown`, `@oxc-project/types`, `@rolldown/binding-*`, napi/emnapi, postcss)
moving with it — all dev-only; no runtime package changed version.

> Housekeeping: this direct dep is a workaround for the peer, not something we
> actually import. Drop it once `vitest` requires `vite >= 8.0.16` on its own.

One aside worth remembering: the first `pnpm add` died mid-download on a
transient TLS abort (`Error: aborted`) and wrote nothing — a network blip, not a
resolution problem. Retrying with a warm store worked. Don't over-diagnose a
network failure as a dependency conflict.

## Lesson / next time

> **Rule:** To control the version of an **auto-installed peer dependency**,
> declare it as a **direct dependency** in your own manifest. `pnpm.overrides` /
> `resolutions` are for *regular* transitives — they don't govern auto-installed
> peers; they only rewrite the requirement, leaving the old version resolved (the
> "unmet peer: found X" warning is the giveaway). And a clean lockfile regen that
> *reproduces* the "wrong" version is telling you it's deterministic resolution,
> not a stale lock.

This extends [`../dependency-version-management.md`](../dependency-version-management.md):
§3.4 covers peer *conflicts* and §3.5 covers `overrides` for transitives, but
neither calls out that overrides silently no-op on **auto-installed** peers. The
"declare it directly" escape hatch belongs alongside those.

## References

- Commit `3c32251` — `ci(audit): make the pnpm audit dependency gate blocking` (issue #20)
- Advisory [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `vite` `server.fs.deny` bypass, patched `>= 8.0.16`
- [`../dependency-version-management.md`](../dependency-version-management.md) §3.4 (peerDependencies) · §3.5 (overrides / resolutions)
- pnpm overrides & `auto-install-peers` — <https://pnpm.io/settings>
