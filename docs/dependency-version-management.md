# Dependency & Version Management — A Practical Guide

> A field manual for the "I spent 7 hours randomly trying versions until it
> worked" problem. Covers **Python**, **npm/pnpm (Node)**, and **CocoaPods
> (pods)**. The goal: replace *random search* with *systematic search*, and
> then capture the result so you never repeat it.

The single idea behind everything here:

> **Dependency hell is a constraint-solving problem, not a luck problem.**
> Somewhere, a compatible set of versions already exists. Your job is to find
> it with a map (declared constraints, changelogs, release dates, the tree),
> not to sample the space at random. And once you find it, you *pin and commit*
> it so the cost is paid exactly once.

---

## Table of contents

- [Part 0 — Mental models (read this first)](#part-0--mental-models-read-this-first)
- [Part 1 — The universal debugging workflow](#part-1--the-universal-debugging-workflow)
- [Part 2 — Python](#part-2--python)
- [Part 3 — npm / pnpm (Node)](#part-3--npm--pnpm-node)
- [Part 4 — CocoaPods (pods)](#part-4--cocoapods-pods)
- [Part 5 — Bisection: systematic version search](#part-5--bisection-systematic-version-search)
- [Part 6 — Capturing the good state (the payoff)](#part-6--capturing-the-good-state-the-payoff)
- [Part 7 — Cheat sheets](#part-7--cheat-sheets)
- [Further reading](#further-reading)

---

## Part 0 — Mental models (read this first)

These concepts are the same in every ecosystem. Learn them once and the
per-language sections become "same idea, different command."

### 0.1 Semantic versioning (semver)

Most packages use `MAJOR.MINOR.PATCH`, e.g. `4.2.1`:

| Part  | Bumped when…                          | Promise to you                     |
|-------|---------------------------------------|------------------------------------|
| MAJOR | Breaking API change                   | **May break your code**            |
| MINOR | New feature, backward-compatible      | Safe to take                       |
| PATCH | Bug fix, backward-compatible          | Safe to take                       |

**The most useful takeaway:** when something breaks after an upgrade, look at
which digit changed. A MAJOR bump breaking you is *expected* — go read that
package's migration guide. A PATCH bump breaking you is a *bug in the package*
(or you were relying on undefined behavior).

> Reality check: semver is a *promise*, not a guarantee. Packages break it all
> the time (accidental breaking changes in a "patch"). That's exactly why
> lockfiles exist — see 0.4.

### 0.2 Version ranges / constraints

Your manifest rarely pins one exact version; it declares a *range*. Each
ecosystem has its own operators, but they all mean "I accept anything in this
band." Cheat table (details in each section):

| Meaning                              | npm        | Python (PEP 440) | CocoaPods |
|--------------------------------------|------------|------------------|-----------|
| Exactly this                         | `1.2.3`    | `==1.2.3`        | `1.2.3`   |
| Patch updates OK (`>=1.2.3 <1.3.0`)  | `~1.2.3`   | `~=1.2.3`        | `~> 1.2.3`|
| Minor+patch OK (`>=1.2.3 <2.0.0`)    | `^1.2.3`   | `~=1.2` (→`1.*`) | `~> 1.2`  |
| Anything at or above                 | `>=1.2.3`  | `>=1.2.3`        | `>= 1.2.3`|

The important insight: **ranges are why `install` on two different days gives
two different trees.** The manifest says "^4.2.0"; on Monday that resolves to
4.2.1, on Friday to 4.3.0 (which quietly broke you). The lockfile is what
freezes that.

### 0.3 Direct vs transitive dependencies

- **Direct**: what *you* asked for (listed in your manifest).
- **Transitive**: dependencies *of* your dependencies, pulled in automatically.

Most "version hell" is transitive: package A needs `left-pad@1`, package B
needs `left-pad@2`, and they can't both be satisfied. You never asked for
`left-pad` — but you have to resolve the conflict. Every ecosystem has a
"**why is this here?**" command (0.6) to trace it.

### 0.4 Manifest vs lockfile — the single most important distinction

| File type      | Written by | Contains                          | Purpose                          |
|----------------|-----------|-----------------------------------|----------------------------------|
| **Manifest**   | You       | Ranges (`^4.2.0`)                 | *Intent* — what you accept       |
| **Lockfile**   | The tool  | Exact resolved versions + hashes  | *Reproducibility* — the exact tree |

| Ecosystem  | Manifest              | Lockfile                                   |
|------------|-----------------------|--------------------------------------------|
| npm        | `package.json`        | `package-lock.json`                        |
| pnpm       | `package.json`        | `pnpm-lock.yaml`                           |
| yarn       | `package.json`        | `yarn.lock`                                |
| Python/pip | `requirements.in` / `pyproject.toml` | `requirements.txt` (compiled) |
| Poetry     | `pyproject.toml`      | `poetry.lock`                              |
| uv         | `pyproject.toml`      | `uv.lock`                                  |
| CocoaPods  | `Podfile`             | `Podfile.lock`                             |

**Rules that prevent most version hell:**

1. **Commit the lockfile.** Always. It is the artifact that makes "works on my
   machine" become "works everywhere."
2. In CI and on teammates' machines, install *from the lockfile* (`npm ci`,
   `pnpm install --frozen-lockfile`, `uv sync --locked`, `pip-sync`, etc.) so
   you get the *exact* tree, not a fresh resolution.
3. The lockfile only changes when *you* intend it to (adding/upgrading a dep) —
   never silently.

### 0.5 The layers below the packages (where the *real* pain lives)

Package-version conflicts are the easy kind. The nasty ones are *below* the
package layer:

```
┌─────────────────────────────────────────┐
│  Your packages         (npm/pip/pods)    │  ← easy: lockfile + ranges
├─────────────────────────────────────────┤
│  Package manager       (pnpm 9 / pip 24) │
├─────────────────────────────────────────┤
│  Language runtime      (Node 24 / Py 3.12)│ ← medium: version managers
├─────────────────────────────────────────┤
│  Native toolchain      (Xcode, CUDA, gcc)│  ← hard: ABI, compiled wheels
├─────────────────────────────────────────┤
│  OS / architecture     (arm64 vs x86_64) │  ← hardest: silent + platform-specific
└─────────────────────────────────────────┘
```

When a JS package "won't install," it's usually the top layer. When `torch`
segfaults or a native pod won't build, the conflict is three layers down and no
amount of changing the *package* version will fix it. **Always identify the
layer first** — it tells you which knob to turn.

### 0.6 The "why is this here?" command (memorize the trio)

The dependency tree is *inspectable*. You never have to guess who pulled
something in:

| Ecosystem | Command                              |
|-----------|--------------------------------------|
| npm       | `npm ls <pkg>` · `npm explain <pkg>` |
| pnpm      | `pnpm why <pkg>`                     |
| yarn      | `yarn why <pkg>`                     |
| Python    | `pipdeptree -p <pkg>` · `pip show <pkg>` |
| Poetry    | `poetry show --tree`                 |
| CocoaPods | `pod dependency` / read `Podfile.lock` |

### 0.7 A taxonomy of version failures

Before you fix anything, classify the failure. This alone saves hours:

1. **Declared conflict** — resolver refuses: "A needs B\@1, C needs B\@2."
   *Fix at the package layer:* upgrade one side, or force a version (overrides).
2. **Breaking API change** — installs fine, crashes at runtime with
   `X is not a function` / `AttributeError`. *Fix:* read the changelog for the
   MAJOR boundary; pin below it or migrate your code.
3. **Peer/host mismatch** — plugin expects host framework version X, you have Y
   (React, ESLint, a pod's iOS deployment target). *Fix:* align the plugin to
   the host, usually by release date.
4. **Runtime mismatch** — package needs Node 20 / Python 3.12 / a newer Xcode.
   *Fix at the runtime layer* (version manager), not the package.
5. **Native/ABI mismatch** — compiled binary vs runtime/OS/arch/CUDA. *Fix at
   the toolchain layer:* correct wheel, correct CUDA build, correct Xcode.
6. **Corrupt/stale install** — not a real conflict at all; a dirty cache or
   stale `node_modules`/`Pods`. *Fix:* clean reinstall (see Part 1, step 5).

> Half of all "version hell" is category 6 masquerading as 1–5. Rule it out
> early — it's the cheapest to fix.

---

## Part 1 — The universal debugging workflow

Do these in order. Stop as soon as it's fixed.

### Step 1 — Read the actual error, name the culprit

Don't bump anything yet. The error text almost always names the package and the
*kind* of failure. Map it to the taxonomy in 0.7. Ask: *which layer* (0.5)?

### Step 2 — Reproduce deterministically

Note the exact command, the runtime version (`node -v`, `python --version`,
`ruby -v`, `xcodebuild -version`), and the OS/arch (`uname -m` → `arm64` vs
`x86_64`). A bug you can't reproduce on demand can't be bisected.

### Step 3 — Inspect the tree, don't guess

Run the "why is this here?" command (0.6) for the suspect package. Turn "some
conflict somewhere" into a concrete sentence: *"A pins B\@1, C needs B\@2."*

### Step 4 — Find the intended-compatible set (the map)

The compatible combination almost always already exists. Find it instead of
rediscovering it:

- **Read the `peerDependencies` / compatibility declarations** — the package
  literally tells you what host versions it supports.
- **Align by release date.** Packages published around the same time were
  tested together. A plugin from 2023 rarely supports a framework from 2025.
  (`npm view <pkg> time`, `pip index versions`, PyPI/GitHub release pages.)
- **Read the CHANGELOG / migration guide** at the version boundary that broke.
- **Copy a known-good set** from the project's official starter/example repo or
  its documented **compatibility matrix** (PyTorch×CUDA, ESLint×plugins,
  React×React-DOM, a pod × iOS deployment target).

### Step 5 — Rule out a dirty install (do this before concluding "incompatible")

A clean reinstall distinguishes a *real* conflict from a corrupt tree:

```bash
# Node (npm)        rm -rf node_modules package-lock.json && npm install
# Node (pnpm)       rm -rf node_modules && pnpm store prune && pnpm install
# Python (venv)     deactivate; rm -rf .venv && python -m venv .venv && ...
# CocoaPods         pod deintegrate && pod cache clean --all && pod install
```

### Step 6 — Change ONE variable at a time

Pin everything else. If you bump three packages and it works, you've learned
nothing and can't undo the useless two-thirds. One change → test → record.

### Step 7 — If you must search, bisect (Part 5), don't sweep linearly

### Step 8 — Capture the good state (Part 6)

Once green: pin it, commit the lockfile, write down *why*, and prove it on a
clean machine / CI.

---

## Part 2 — Python

### 2.1 The layers, specifically

```
your packages (numpy, torch, django, ...)
    ↑ installed by
pip / poetry / uv / conda        ← the installer/resolver
    ↑ into
a virtual environment (venv)     ← isolation boundary — ALWAYS use one
    ↑ built on
the interpreter (CPython 3.12)   ← managed by pyenv / uv / the OS
    ↑ sometimes needs
native toolchain (C compiler, CUDA, BLAS)  ← the wheel-vs-source story
```

**Non-negotiable habit: one virtual environment per project.** Never
`pip install` into the system Python. A venv is the isolation boundary that
makes projects reproducible and prevents "upgrading project A broke project B."

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install -U pip
```

### 2.2 PEP 440 versions & operators (Python is *not* strict semver)

Python uses [PEP 440](https://peps.python.org/pep-0440/), which allows things
semver doesn't (`1.2.3`, `2.0.0rc1`, `1.4.post2`, `1.0.dev3`). Operators in a
`requirements`/`pyproject` spec:

| Spec           | Means                                    |
|----------------|------------------------------------------|
| `==1.4.2`      | Exactly 1.4.2                            |
| `==1.4.*`      | Any 1.4.x                               |
| `>=1.4,<2.0`   | Range                                    |
| `~=1.4.2`      | "Compatible release": `>=1.4.2,==1.4.*`  |
| `~=1.4`        | `>=1.4,==1.*`                            |
| `!=1.5.0`      | Exclude a known-bad version             |

The `~=` "compatible release" operator is the Python equivalent of npm's `^`/
`~` and it's the one most people don't know — it's the right default for
"take patch/minor fixes but not breaking majors."

### 2.3 Choosing an installer/manager

| Tool          | Manifest → lockfile              | Use it when…                                    |
|---------------|----------------------------------|-------------------------------------------------|
| **pip**       | `requirements.txt` (manual)      | Simple scripts; baseline everyone has           |
| **pip-tools** | `requirements.in` → `requirements.txt` | You want pip + a real lockfile, minimal magic |
| **Poetry**    | `pyproject.toml` → `poetry.lock` | App with many deps; want one tool for env+build |
| **uv**        | `pyproject.toml` → `uv.lock`     | Modern default: extremely fast, does env+lock+python |
| **conda**     | `environment.yml`                | Heavy native/science stack (CUDA, MKL, GDAL)    |

> If you're starting fresh in 2025+, **uv** is the pragmatic modern default
> (fast, handles the interpreter *and* the lockfile). Poetry is the mature
> incumbent. Plain pip + pip-tools is the "no new tools" option. conda earns
> its place only when native/scientific binaries dominate.

### 2.4 The lockfile story in pip-land

Plain `pip freeze > requirements.txt` captures *everything installed* but
doesn't separate *what you asked for* from *what got pulled in*, and it has no
hashes. The professional pattern is **pip-tools**:

```bash
pip install pip-tools
# requirements.in  ← YOU edit this (top-level intent, ranges)
pip-compile requirements.in          # → requirements.txt (fully pinned + hashes)
pip-sync requirements.txt            # make the venv EXACTLY match the lock
```

`requirements.in` is your manifest; the compiled `requirements.txt` is your
lockfile. Commit both. `pip-sync` is the "install from lockfile exactly"
equivalent of `npm ci`.

### 2.5 Pinning the interpreter

The version *below* the packages. Two common tools:

```bash
# pyenv
pyenv install 3.12.4
pyenv local 3.12.4          # writes .python-version (commit it)

# uv (also manages interpreters)
uv python install 3.12
uv venv --python 3.12
```

A `.python-version` file (pyenv) or the `requires-python` field in
`pyproject.toml` documents the runtime so CI and teammates match you.

### 2.6 Inspecting & diagnosing

```bash
pip show <pkg>                 # version, location, requires, required-by
pip check                      # report installed packages with broken deps
pipx run pipdeptree            # full dependency tree
pipdeptree -r -p <pkg>         # reverse tree: WHO requires this package?
pip index versions <pkg>       # what versions exist on the index
poetry show --tree             # (poetry) tree view
uv pip tree                    # (uv) tree view
```

### 2.7 The classic: PyTorch × CUDA (the canonical "layers" trap)

This is the textbook case where changing the *package* version endlessly never
works because the conflict is in the **native/ABI layer**. `torch` ships
different builds compiled against different CUDA versions, and those must match
your GPU driver.

Do **not** `pip install torch` and hope. Use the official selector/matrix and
install from the correct index:

```bash
# Example: torch built for CUDA 12.1
pip install torch --index-url https://download.pytorch.org/whl/cu121
# CPU-only build:
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

The lesson generalizes to any package with compiled extensions
(`numpy`/`scipy` + BLAS, `psycopg2` vs `psycopg2-binary`, `lxml`,
GPU libraries): **match the wheel to your Python version + OS + architecture +
native runtime**, using the project's compatibility matrix — not version
roulette.

### 2.8 Python gotchas checklist

- ❌ Installing into system Python. ✅ Always a venv.
- ❌ `sudo pip install`. ✅ Never; it's a symptom of skipping the venv.
- **Wheel vs sdist:** if pip is *compiling* (`Building wheel for …` then a C
  error), there's no prebuilt wheel for your Python/OS/arch. Fix the *platform
  match*, don't fight the package version.
- **`-binary` packages:** e.g. `psycopg2-binary` (prebuilt) vs `psycopg2`
  (compiles). Prefer the binary for dev.
- **`requires-python`:** a package may simply not support your interpreter.
  `pip` will tell you "requires a different python version."
- **arm64 vs x86_64 (Apple Silicon):** a Rosetta/x86 Python will silently pull
  x86 wheels. Check `python -c "import platform; print(platform.machine())"`.

---

## Part 3 — npm / pnpm (Node)

### 3.1 semver ranges in `package.json`

The operators you'll see constantly:

| Range      | Expands to          | Notes                                            |
|------------|---------------------|--------------------------------------------------|
| `1.2.3`    | exactly 1.2.3       | Pinned                                           |
| `^1.2.3`   | `>=1.2.3 <2.0.0`    | **npm default** on `install`. Caret = "same MAJOR" |
| `~1.2.3`   | `>=1.2.3 <1.3.0`    | Tilde = "same MINOR"                              |
| `^0.2.3`   | `>=0.2.3 <0.3.0`    | ⚠️ Caret special-cases 0.x: locks to MINOR       |
| `^0.0.3`   | `>=0.0.3 <0.0.4`    | ⚠️ And 0.0.x: locks to PATCH                      |
| `*` / `latest` | anything        | Never do this in a real project                  |

The 0.x special-casing trips people up: below 1.0.0, `^` gets *stricter*
because pre-1.0 packages are assumed unstable. Play with ranges at
[semver.npmjs.com](https://semver.npmjs.com/).

### 3.2 How resolution differs: npm vs pnpm

- **npm / yarn (classic)** build a `node_modules` with **hoisting** —
  transitive deps get flattened up to the top so they can be shared. Side
  effect: **phantom dependencies** — your code can `require('some-transitive')`
  that you never declared, and it works… until the hoist layout changes and it
  vanishes. Fragile.
- **pnpm** uses a **content-addressable global store** plus a symlinked
  `node_modules`: every package version is stored once on disk and hard-linked
  in. It is **strict** — you can only import what you actually declared, so
  phantom deps become errors, not time bombs. It's also faster and far more
  disk-efficient across projects.

> If you get to choose, pnpm's strictness prevents a whole class of "worked
> yesterday" bugs. (This repo uses pnpm — see `CLAUDE.md`.)

### 3.3 Lockfiles & reproducible installs

| Command                              | What it does                                       |
|--------------------------------------|----------------------------------------------------|
| `npm install`                        | Resolves ranges, **may update** the lockfile       |
| `npm ci`                             | Installs **exactly** the lockfile; fails if drifted; wipes `node_modules` |
| `pnpm install`                       | Resolves; updates lockfile if needed               |
| `pnpm install --frozen-lockfile`     | Exact install from lock; fails on drift (CI default) |

**Rule:** developers use `install`; **CI and Docker builds use `ci` /
`--frozen-lockfile`.** That's what guarantees the build matches the committed
lock. Commit the lockfile; never `.gitignore` it.

### 3.4 `peerDependencies` — the #1 source of npm conflicts

A **peer dependency** says: "I need this package, but *you* (the host app) must
provide it, and we must agree on the version." Plugins use this so they share a
single copy of the framework with your app. Example: `some-react-plugin`
declares `peerDependencies: { react: "^18" }`. If your app has React 19, you
get the infamous:

```
npm error ERESOLVE unable to resolve dependency tree
npm error peer react@"^18.0.0" from some-react-plugin@2.1.0
```

**How to resolve it — in order of preference:**

1. **Find a plugin version whose peer range includes your host.** Usually a
   newer plugin release supports the newer framework. Check by release date /
   changelog. `npm view some-react-plugin peerDependencies` shows the range per
   version. *This is the correct fix.*
2. If the plugin genuinely lags, **hold the host back** to a version the plugin
   supports (a deliberate, recorded decision).
3. **Escape hatches (use sparingly, and write down why):**
   - `npm install --legacy-peer-deps` — install anyway, ignore peer conflicts
     (npm ≤6 behavior). May actually work if the incompatibility is only in the
     declared range, not the real API.
   - `npm install --force` — bigger hammer, more collateral.
   - **Override the resolved version** (see 3.5).

### 3.5 Forcing a transitive version: `overrides` / `resolutions`

When a *transitive* dep is the problem (a dep-of-a-dep is too old/has a CVE),
force it in your manifest:

```jsonc
// npm & pnpm (package.json)
{
  "overrides": {
    "left-pad": "1.3.0",
    "some-pkg": { "left-pad": "1.3.0" }   // scoped: only under some-pkg
  }
}

// pnpm-specific, more powerful:
{ "pnpm": { "overrides": { "left-pad@<1.3.0": "1.3.0" } } }

// yarn uses a different key:
{ "resolutions": { "left-pad": "1.3.0" } }
```

Powerful but a smell — you're overriding what a package asked for. Comment
*why* (usually a security patch or an upstream bug) and revisit periodically.

### 3.6 Inspecting & diagnosing

```bash
npm ls <pkg>              # where <pkg> sits in the tree (and dupes)
npm explain <pkg>         # WHY <pkg> is installed (the chain)
pnpm why <pkg>            # pnpm equivalent
npm outdated              # current vs wanted (range) vs latest
npm view <pkg> versions --json     # every published version
npm view <pkg> time                # publish DATES (align by date!)
npm view <pkg> peerDependencies    # what host versions it demands
npm dedupe                # collapse duplicate versions where possible
```

### 3.7 Pinning the Node runtime

The layer below the packages. A version mismatch here (`engine`
incompatibility, native module built for another ABI) is *not* fixed by
changing packages.

```jsonc
// package.json — document + optionally enforce
{ "engines": { "node": ">=24 <25", "pnpm": ">=9" } }
```

```bash
# nvm            .nvmrc file with "24"   → nvm use
# volta          volta pin node@24       → pins in package.json, auto-switches
# asdf / mise    .tool-versions          → multi-language
corepack enable  # ships with Node; pins the pnpm/yarn version per project
```

Commit `.nvmrc` / `.tool-versions` and set `engines` so everyone (and CI) runs
the same runtime you did.

### 3.8 Node gotchas checklist

- **`ERESOLVE`** → peer-dependency conflict. Go to 3.4; don't reach for
  `--force` first.
- **Native modules** (`node-gyp`, `sharp`, `bcrypt`, `better-sqlite3`) are
  compiled per Node-ABI + OS + arch. After a Node major upgrade or moving
  between arm64/x86, run a clean reinstall so they rebuild.
- **Mixed package managers** → delete the foreign lockfile. Never keep both
  `package-lock.json` and `pnpm-lock.yaml`; pick one manager per repo.
- **Deleting the lockfile "to fix things"** re-resolves everything to latest
  in-range and often *causes* the breakage. Prefer a targeted change.
- **`npm audit fix --force`** can bump majors and break you. Read what it wants
  to do first.

---

## Part 4 — CocoaPods (pods)

CocoaPods is the Ruby-based dependency manager for iOS/macOS (Objective-C /
Swift) projects. The mental models are identical; the layers just include Ruby
and Xcode.

### 4.1 The layers, specifically

```
your pods (Alamofire, Firebase, ...)
    ↑ managed by
CocoaPods (a Ruby gem)           ← itself version-sensitive
    ↑ runs on
Ruby (system Ruby vs rbenv/rvm)  ← "needs a newer Ruby" is common
    ↑ integrates into
Xcode + the .xcworkspace          ← native toolchain; SDK/deployment target
    ↑ on
macOS + arch (arm64 / x86_64)     ← Apple Silicon & Rosetta issues
```

Two things people miss: **CocoaPods itself is a versioned gem** (so "it worked
on my machine" can be a *CocoaPods* version difference), and **pods are coupled
to Xcode / the iOS deployment target**, so a pod can be "incompatible" because
of your Xcode or minimum-iOS setting, not its own version.

### 4.2 The files

| File            | Role                                             | Commit? |
|-----------------|--------------------------------------------------|---------|
| `Podfile`       | **Manifest** — your declared pods + ranges       | ✅ Yes  |
| `Podfile.lock`  | **Lockfile** — exact resolved versions           | ✅ **Yes** |
| `*.xcworkspace` | What you open in Xcode after integrating pods     | ✅ Yes  |
| `Pods/`         | Installed pod sources (like `node_modules`)       | Team's call* |

\* Many teams `.gitignore` `Pods/` and rely on `Podfile.lock` + `pod install`;
others commit `Pods/` for hermetic builds. Either way, **always commit
`Podfile.lock`.**

### 4.3 Podfile version operators

```ruby
platform :ios, '15.0'          # deployment target — part of the constraint set!

target 'MyApp' do
  use_frameworks!

  pod 'Alamofire'              # any version (avoid — unpinned)
  pod 'Alamofire', '5.9.1'     # exactly 5.9.1
  pod 'Alamofire', '~> 5.9'    # >= 5.9, < 6.0   (optimistic operator)
  pod 'Alamofire', '~> 5.9.1'  # >= 5.9.1, < 5.10.0
  pod 'Alamofire', '>= 5.0', '< 6.0'   # explicit range
end
```

`~>` is the **optimistic operator** ("twiddle-wakka"): it allows the last digit
to increase. `~> 5.9` → up to but excluding `6.0`; `~> 5.9.1` → up to but
excluding `5.10.0`. It's CocoaPods' `^`/`~` — the sane default.

### 4.4 The #1 CocoaPods confusion: `pod install` vs `pod update`

This mistake causes enormous amounts of wasted time. Learn it cold:

| Command                | What it does                                                            |
|------------------------|-------------------------------------------------------------------------|
| `pod install`          | Installs versions **from `Podfile.lock`** if present; only resolves pods not yet locked. **Respects the lock.** |
| `pod update`           | **Ignores the lock**, re-resolves *everything* to the newest allowed by the `Podfile`, rewrites `Podfile.lock`. |
| `pod update Alamofire` | Re-resolves **only** Alamofire (and its deps); leaves the rest locked. |

**Rules:**
- Cloning a project / adding a new pod / on CI → **`pod install`**.
- Deliberately upgrading a specific pod → **`pod update <PodName>`** (targeted).
- Almost **never** bare `pod update` — it silently upgrades every pod at once
  and is a classic way to detonate a working build. If you ran it and things
  broke, that's why.

### 4.5 Inspecting & diagnosing

```bash
pod --version                       # YOUR CocoaPods version (matters!)
pod outdated                        # pods with newer versions available, vs lock
cat Podfile.lock                    # the source of truth for what's installed
pod repo update                     # refresh the local spec repo (pod metadata)
pod install --repo-update           # refresh specs then install
```

`Podfile.lock` also records the CocoaPods version that wrote it and a checksum
per pod — diffing it in code review shows exactly what changed.

### 4.6 The clean-reinstall / reset toolkit

CocoaPods accumulates state in more places than npm; category-6 "corrupt
install" issues are common. Escalating cleanup:

```bash
pod install                                   # 1. normal
pod repo update && pod install                # 2. stale spec metadata
pod cache clean --all                         # 3. clear the download cache
pod deintegrate && pod install                # 4. rip pods out of the project, re-add
rm -rf ~/Library/Developer/Xcode/DerivedData  # 5. Xcode's build cache (the real culprit surprisingly often)
rm -rf Pods Podfile.lock && pod install       # 6. nuclear: re-resolve from scratch
```

Xcode's **DerivedData** cache is the single most common reason a pod "still
doesn't work" after you fixed the version — clear it before concluding the
versions are wrong.

### 4.7 Pinning the layers below

```bash
# Ruby (CocoaPods is a gem — pin its Ruby + its own version)
rbenv local 3.2.2                 # .ruby-version
# Use Bundler so the CocoaPods VERSION is pinned per project:
#   Gemfile:  gem 'cocoapods', '1.15.2'
bundle install
bundle exec pod install           # runs the pinned CocoaPods, not whatever's global
```

Using **Bundler** (`Gemfile` + `Gemfile.lock`, run via `bundle exec pod ...`)
is the pro move: it pins the *CocoaPods version itself*, killing the "works with
my pod version but not yours" class of bug. Also pin the **Xcode version**
(document it; CI uses `xcode-select` / a `.xcode-version` file) and keep
`platform :ios, 'X'` under source control — it's part of the constraint set.

### 4.8 A note on Swift Package Manager (SPM)

The Apple ecosystem is shifting from CocoaPods toward **Swift Package Manager**
(built into Xcode). Same mental models apply: `Package.swift` is the manifest,
`Package.resolved` is the lockfile (**commit it**), and "Reset Package Caches" /
"Resolve Package Versions" in Xcode are the clean-reinstall equivalents. If
you're choosing today for a new project, SPM is the forward-looking default;
CocoaPods remains everywhere in existing codebases.

### 4.9 CocoaPods gotchas checklist

- ❌ Bare `pod update` to "fix" things. ✅ `pod install`, or targeted
  `pod update <Pod>`.
- **Forgot to open the `.xcworkspace`** (opened `.xcodeproj` instead) → "module
  not found" for every pod. Always open the workspace.
- **Apple Silicon / arch:** older pods may need
  `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` or a Rosetta terminal. A
  symptom that looks like a version problem but is an arch problem.
- **Global vs Bundler CocoaPods** mismatch → pin with Bundler and use
  `bundle exec`.
- **Deployment target too low/high** for a pod → the conflict is
  `platform :ios`, not the pod version.
- **`.symlink`/`.netrc` / spec repo out of date** → `pod repo update`.

---

## Part 5 — Bisection: systematic version search

When there's *genuinely* no documented compatible set and you must search,
**binary-search — don't sweep linearly.** 100 versions is ~7 tests by halving,
vs. up to 100 by brute force.

### 5.1 Bisecting a dependency version

1. Find a **known-good** version (older) and a **known-bad** version (current).
2. Pin the **midpoint** and test. One variable only (Part 1, step 6).
3. Good → the break is in the newer half. Bad → it's in the older half.
4. Repeat on the surviving half until you find the exact version where behavior
   flips. Read *that* release's changelog — it names the breaking change.

Record each result so you never re-test a version:

```
14.0  good
15.0  ?     ← test the midpoint, not the next version
16.0  bad
```

### 5.2 Bisecting your *own* commits with `git bisect`

If the regression is in your code/config (or "it worked last week"), let git
find the exact commit automatically:

```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good <old-sha>      # this old commit worked
# git checks out the midpoint; you test and mark each:
git bisect good    # or:  git bisect bad
# ... repeats ~log2(N) times, then prints the first bad commit
git bisect reset               # when done

# Fully automated: exit 0 = good, non-zero = bad
git bisect run ./scripts/repro-test.sh
```

`git bisect run <script>` is the power move: hand it a script that reproduces
the bug and it finds the culprit commit unattended. This is how a pro turns
"7 hours of guessing" into "a coffee break."

---

## Part 6 — Capturing the good state (the payoff)

Finding the working set is only half the job. The professional difference is
making sure **you pay this cost exactly once.**

1. **Pin & commit the lockfile.** `package-lock.json` / `pnpm-lock.yaml` /
   `poetry.lock` / `uv.lock` / compiled `requirements.txt` / `Podfile.lock` /
   `Package.resolved`. This is the whole point of a lockfile.
2. **Pin the runtime.** `.nvmrc` / `engines`, `.python-version` /
   `requires-python`, `.ruby-version` + Bundler-pinned CocoaPods, documented
   Xcode/CUDA version.
3. **Write down *why*** — a comment in the manifest or a short ADR:
   `# pinned foo@2.3 — 2.4 drops Node 20 support (see issue #123)`. Future-you
   will not remember, and an unexplained pin gets "helpfully" bumped later.
4. **Install from the lock in CI**, on a clean machine (`npm ci`,
   `pnpm install --frozen-lockfile`, `uv sync --locked`, `pip-sync`,
   `bundle exec pod install`). If it's not reproducible on a machine that isn't
   yours, it isn't really fixed.
5. **Upgrade deliberately, one thing at a time**, on a branch, reading the
   changelog — not by nuking the lockfile and re-resolving to latest.

> The mindset flip in one line: **treat dependencies as a constraint system you
> debug with a map (declared ranges, changelogs, release dates, the tree), then
> freeze the solution.** That's the entire difference between "random version
> roulette" and professional dependency management.

---

## Part 7 — Cheat sheets

### Python
```bash
python -m venv .venv && source .venv/bin/activate   # isolate (always)
pip install -U pip
pip-compile requirements.in       # lock (pip-tools)
pip-sync requirements.txt         # install EXACTLY the lock
pip check                         # broken deps?
pipdeptree -r -p <pkg>            # who requires <pkg>?
pip index versions <pkg>          # available versions
pyenv local 3.12.4                # pin interpreter
# modern all-in-one: uv venv / uv add / uv sync --locked / uv python install
```

### npm / pnpm
```bash
npm ci                            # install EXACTLY the lock (CI)
pnpm install --frozen-lockfile    # pnpm equivalent
npm explain <pkg>                 # why is <pkg> here?
pnpm why <pkg>
npm outdated                      # current vs wanted vs latest
npm view <pkg> time               # release DATES (align by date)
npm view <pkg> peerDependencies   # host versions demanded
# overrides / resolutions in package.json to force a transitive version
```

### CocoaPods
```bash
pod install                       # respect the lock (default action)
pod update <Pod>                  # upgrade ONE pod deliberately
pod outdated                      # what's upgradable
bundle exec pod install           # use the Bundler-pinned CocoaPods version
pod deintegrate && pod install    # clean reintegrate
rm -rf ~/Library/Developer/Xcode/DerivedData   # clear Xcode cache
# always commit Podfile.lock; always open the .xcworkspace
```

### git bisect (any ecosystem)
```bash
git bisect start; git bisect bad; git bisect good <sha>
git bisect run ./repro-test.sh    # automated culprit hunt
git bisect reset
```

---

## Further reading

- Semantic Versioning spec — <https://semver.org/>
- npm semver calculator — <https://semver.npmjs.com/>
- PEP 440 (Python versioning) — <https://peps.python.org/pep-0440/>
- pip-tools — <https://github.com/jazzband/pip-tools>
- uv — <https://docs.astral.sh/uv/>
- Poetry — <https://python-poetry.org/docs/>
- pnpm (motivation & store model) — <https://pnpm.io/motivation>
- CocoaPods — <https://guides.cocoapods.org/>
- PyTorch install matrix — <https://pytorch.org/get-started/locally/>
- `git bisect` docs — <https://git-scm.com/docs/git-bisect>

---

*Skim Part 0 and Part 1 until they're reflexes — they're 80% of the value.
The per-ecosystem parts are lookups for when you're actually stuck.*
