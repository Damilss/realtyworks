# PWA (Android, iOS, iPadOS)

How RealtyWorks becomes installable, and what each platform actually gives us.

**Phase 5 scope — do not build this earlier.** The PWA install layer (manifest +
service worker) lands in Phase 5 as a **bolt-on** to an already-responsive app
(`CLAUDE.md` §2, §4). Nothing here is installed or configured yet. This document
exists so the platform constraints are known *before* the UI is built, because
two of them (push, offline) have design consequences that are painful to
retrofit.

**The one-line policy:** one responsive codebase, installable to the home
screen. No native app, no second surface, no `m.` subdomain. The responsive PWA
*is* the entire mobile story (`CLAUDE.md:120`, `CLAUDE.md:157-164`).

---

## Why this matters before Phase 5

Two things in this doc are **not** bolt-ons, and if they're ignored until Phase 5
they turn into rework:

1. **Responsive-first from day one.** Dense tables for managers on desktop;
   stacked, touch-friendly views for vendors on phones. A vendor standing in a
   boiler room with one hand free is the actual mobile user. Build for that as
   pages are written in Phase 3/5 — the install layer assumes it.
2. **Push notifications require an installed app on iOS.** If the plan ever
   depends on reaching a vendor's iPhone via *web* push, that vendor must first
   have manually installed the app to their home screen. See
   [Push notifications](#push-notifications) — this is the single biggest
   platform constraint, and it's why SMS (`CLAUDE.md` §6) remains the default
   notification channel.

---

## Platform reality

The three "platforms" are really two engines. Android runs Chromium (real
install prompts, push without install). iOS **and** iPadOS run WebKit/Safari —
Apple's engine is the only one that can install a home-screen web app, so an
iPhone and an iPad behave the same way, and "installing Chrome on the iPhone"
changes nothing.

| | **Android** (Chrome/Chromium) | **iOS / iPadOS** (Safari/WebKit) | **Desktop** (Chrome/Edge) |
|---|---|---|---|
| Install to home screen | ✅ Yes | ✅ Yes, **manual only** | ✅ Yes |
| Browser-fired install prompt (`beforeinstallprompt`) | ✅ Supported | ❌ **Does not exist** | ✅ Supported |
| How the user installs | Prompt / menu → Install app | Share sheet → **Add to Home Screen** | Address-bar install icon |
| Web push | ✅ Works in the browser tab | ⚠️ **Only after home-screen install** (iOS/iPadOS **16.4+**) | ✅ Works in the tab |
| Service worker / offline cache | ✅ Yes | ✅ Yes | ✅ Yes |
| Runs standalone (no browser chrome) | ✅ Yes | ✅ Yes | ✅ Yes |

Sources: the Next.js 16 PWA guide bundled in this repo
(`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`) states
web push is supported on "iOS 16.4+ for applications installed to the home
screen," and explicitly warns that `beforeinstallprompt` "does not work on
Safari iOS."

### What this means in practice

- **You cannot programmatically prompt an iPhone user to install.** There is no
  API. You render instructions ("tap Share, then Add to Home Screen") and hope.
  Detect the case with a `/iPad|iPhone|iPod/` user-agent test plus
  `window.matchMedia('(display-mode: standalone)')` to check they haven't already
  installed — the Next.js guide shows exactly this `InstallPrompt` pattern.
- **Android install is a real prompt**, so Android adoption will be materially
  higher than iOS for free. Do not read low iOS install numbers as "the PWA
  failed."
- **HTTPS is required** for both the service worker and install, everywhere
  except `localhost`. Locally that means `next dev --experimental-https` (per
  the Next.js guide) — plain `pnpm dev` will not let you test push.

### ⚠️ Verify at build time

My platform knowledge has a cutoff and Safari's PWA behavior moves. Confirm
these against current WebKit release notes when Phase 5 starts, rather than
trusting this table:

- Whether iPadOS still matches iOS exactly (same engine today, but Apple has
  split iPad behavior before).
- **Storage eviction:** Safari has historically evicted script-writable storage
  (IndexedDB, Cache API, service worker registrations) after ~7 days of no user
  interaction with a *non-installed* site, with home-screen apps exempt. If any
  offline design depends on cached data surviving a week, verify this first.
- Badging (unread counts on the app icon) — believed supported on installed iOS
  web apps since 16.4, unverified.

---

## Push notifications

**Do not treat web push as a replacement for SMS.** `CLAUDE.md` §6 makes SMS
(Twilio) the notification channel, and that decision survives the PWA for one
reason: web push on iOS only reaches users who have *already manually installed
the app*. A vendor who never installs is unreachable by push but always
reachable by text.

If web push is added in Phase 5, it is a **second channel**, and it inherits
every §6 rule:

- It logs to the same `messages` table (to, body, trigger, provider ref, status).
- It respects `notification_preferences` — that table already anticipates a
  `channel` column; web push is one.
- **New schema requirement:** push subscriptions must be **persisted per user**
  (endpoint + keys). The Next.js guide's example stores the subscription in a
  module-level variable and explicitly flags that production needs a database —
  a serverless function cannot hold that in memory (see the serverless notes in
  `CLAUDE.md` §2). That is a real table, and it should be designed with the rest
  of the schema (`docs/schema/schema-brainstorming.md`), not bolted on.
- **VAPID keys are secrets.** `VAPID_PRIVATE_KEY` is server-only and belongs in
  `.env.local` / the host's env, never `NEXT_PUBLIC_*`. Only the public key is
  client-visible. Sends happen in a server action or edge function — never the
  browser (§2 trust rule).

---

## Offline scope — decide it, don't drift into it

A service worker is required for push, but **offline caching is a separate,
optional decision** with real cost. The Next.js guide is explicit: offline
support means adding [Serwist](https://github.com/serwist/serwist), and
"**this plugin currently requires webpack configuration**."

**That collides with our stack.** Next.js 16 uses **Turbopack as the default
bundler** for both `next dev` and `next build`; webpack requires opting out with
`--webpack` (confirmed in `node_modules/next/dist/docs/01-app/01-getting-started/01-installation.md`).
So full offline support may force a bundler decision for the whole app. **Check
whether Serwist supports Turbopack before assuming offline is cheap.**

Recommended default, unless a real user need appears:

- ✅ **Ship:** manifest + a minimal hand-written `public/sw.js` that handles
  `push` and `notificationclick` (the Next.js guide's service worker is ~20
  lines and needs no bundler plugin at all).
- ❌ **Skip:** offline read/write of work orders, background sync, queued
  mutations. Offline *writes* mean conflict resolution and a sync queue — that's
  a distributed-systems problem, and it is nowhere in the MVP scope (`CLAUDE.md`
  §1). An offline work-order edit that silently loses a vendor's photo is worse
  than an honest "you're offline" screen.

If offline is genuinely needed later (vendors in basements with no signal is a
*plausible* real requirement), scope it as its own phase-gated decision with the
bundler question answered first.

---

## Build notes (Phase 5 — verified against the bundled Next.js 16 docs)

Per `AGENTS.md`, these were read from `node_modules/next/dist/docs/`, not
recalled. Re-read them at build time.

| Piece | Where it goes | Notes |
|---|---|---|
| Manifest | `src/app/manifest.ts` | Export a default fn returning `MetadataRoute.Manifest` (typed). Next serves it automatically — do **not** hand-place a `manifest.json` in `public/`. |
| Icons | `src/app/icon.png`, `src/app/apple-icon.png` | Next file conventions; `apple-icon` emits `<link rel="apple-touch-icon">`. Manifest also needs 192×192 + 512×512 in `public/`. |
| Service worker | `public/sw.js` | Registered manually via `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`. |
| SW headers | `next.config.ts` | The guide sets `Cache-Control: no-cache, no-store, must-revalidate` + a strict CSP on `/sw.js` so users always get the current worker. |
| Push sends | `src/server/actions/` | `web-push` + VAPID keys. Server-only, per §2. |
| Local testing | `next dev --experimental-https` | Push/install will not work over plain HTTP. |

Relevant guides:
`01-app/02-guides/progressive-web-apps.md` ·
`01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` ·
`01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`

### Auth interaction (easy to get wrong)

`start_url` in the manifest is where the app opens when launched from the home
screen. Our authed app lives behind a `(dashboard)` route group. Point
`start_url` at a route that behaves correctly for a **logged-out** user (i.e.
redirects to login) — otherwise a vendor whose session expired taps the icon and
lands on an error instead of a login screen.

---

## Open questions for Phase 5

1. **Do we need web push at all**, given SMS already covers vendor notification
   (§6) and iOS push requires install? Cheapest honest answer may be "no."
2. **Is offline read-only worth a bundler change?** (Serwist + Turbopack — see
   above.)
3. **Do we actively promote install** (an in-app "Add to Home Screen" nudge for
   vendors), or leave it discoverable? Affects whether push is even viable on
   iOS.
4. **Which icon set / brand assets** — needs real design input, not a generator
   default.
