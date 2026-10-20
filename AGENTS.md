# AGENTS.md

This file guides AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository.

## Overview

Moto Garage is a unit tracker for a motorcycle and car buy-and-sell business. It is plain HTML, CSS and JavaScript with no build step, package manager or tests. Data lives in Firebase Firestore (project `moto-garage-dmem`, free Spark plan, so don't use any feature that needs Blaze, such as Cloud Storage or Functions). The site is hosted on Firebase Hosting.

- Run locally: `npx serve .` (Python is not installed on the owner's machine).
- Deploy site and rules: `npx firebase-tools deploy`.

## Architecture

- `js/app.js` is one IIFE. `start()` loads the Firebase modular SDK from gstatic with dynamic `import()` at the version pinned in `FIREBASE_SDK`, and merges the modules into `fb`. If the import fails, the setup screen explains it.
- A hash router (`#/`, `#/units`, `#/units/new`, `#/units/:id`, `#/units/:id/edit`) calls a `render*` function per view, which writes `view.innerHTML` and attaches listeners. Escape all user data with `esc()`.
- `routeToken` / `stale(token)` drop renders that finish after the user has already navigated away.
- All Firestore access goes through the `api` object. Data layout: `units/{id}`, `units/{id}/expenses/{id}` and `units/{id}/photos/{id}`. Each unit stores a running `total_expenses` and `photo_count`, updated in the same `writeBatch` with `increment()` as each expense or photo write. Keep that invariant. `deleteUnit` deletes both subcollections first.
- Photos: Spark has no Cloud Storage, so `processPhoto()` shrinks each image to a JPEG data URL (max 1280px) plus a 128px square `thumb`. Full photos live in the `photos` subcollection and are loaded only on the unit page, which shows thumbnails next to Details in `.top-row`; `openPhotoViewer()` shows the full photo with cover/delete actions. The cover's `thumb` and `cover_id` are copied onto the unit for lists. `MAX_PHOTOS` is 8.
- Status is `in_stock` → optional `reserved` (`reserved_by`, `reserved_date`, `deposit`, `agreed_price`) → `sold`. Reservation fields are kept after a sale. `papers` is a map updated with dot paths: `orcr` is `'original'`, `'xerox'` or `null` (see `ORCR`), and `deed` and `owner_id` are booleans. Read papers through `hasPaper()`. Papers are edited only in the add/edit form (`papersFieldsHtml()`) and saved with the rest of the unit; the unit page shows a read-only summary. The form sets `leaveGuard`, which asks before navigating away with unsaved changes. Older units may have `orcr: true` or old keys, which count as not done.
- The Reports page reads every expense with a `collectionGroup('expenses')` query, which `firestore.rules` allows separately. Its chart is a hand-built SVG in `drawProfitChart()`, which puts losses below the zero line and has a table view.
- `summarize()` derives `total_cost`, `profit` and `days_in_stock`. Lists are fetched whole and sorted and filtered client-side, which is fine for a small dealer. No Firestore indexes are needed.
- Form validation: `field()` renders an input plus `<p class="error" id="{name}-error">`. `validate(form, extra)` uses native validity and an optional `{ name: value => message }` map. `formValues()` converts the names in `NUMERIC` to numbers and blank values to `null`.
- The logo and app icons are fixed files in `img/`: `mark.png` (scooter only, top bar and favicon), `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` (home screen, listed in `manifest.webmanifest`; `icon-512.png` is also the icon above the login card), and `logo.png` (the full logo with text, kept as the source and not used by the app). They are not editable in the app. Logged out, `showChrome(false)` adds `body.guest`, so the top bar shows only the brand and, on the login screen, a Log in button (`#guest-login`) that focuses the email field. There is no sign-up; the owner adds accounts.
- Business name, phone, email and address live in `settings/business` (`api.getBusiness`/`saveBusiness`), edited on the Profile page (`#/profile`, `renderProfile()`). `applyBranding()` puts the name in the top bar and tab title and caches it in localStorage for the login screen. Older documents may still have an unused `logo` field. The user's own name is the Firebase Auth `displayName`, shown in the header avatar (`updateAvatar()`).
- Cash (`#/cash`, `renderCash()`): money on hand is never stored. `cashLedger()` derives it from the starting money in `settings/cash` ({amount, as_of}) plus every event dated on or after `as_of`: unit purchases and expenses (out), reservation deposits and sales (in; a sale after a deposit counts only the balance), and manual entries in the `cash` collection ({type: in|out, amount, date, note}). Editing or deleting a unit or expense updates it automatically.
- Access control is the email allowlist in `firestore.rules`. When adding an email, create that Auth user at the same time, so no one else can register the address first.

## Conventions

- Money is PHP, formatted with `Intl.NumberFormat('en-PH', { currency: 'PHP' })` through `money()` and `signed()`.
- Dates are `YYYY-MM-DD` strings. `today()` returns the local date, not UTC.
- Colors are CSS variables on `:root` (light purple "Soft UI" theme from UI/UX Pro Max; `--accent` #7c3aed, `--accent-strong` for accent text). Font: Plus Jakarta Sans. Phones (<768px) use `#bottom-nav` instead of the top tabs; `showChrome()` toggles both. The Units page has a photo grid (`unitCard()`, using the 4:3 `card` image on each unit) and a list view; the dashboard is a bento grid with a 6-month `sparkline()`. Use `color-mix(in srgb, …)`. The layout is mobile-first, with breakpoints at 640, 768 and 1024px at the end of `styles.css`.
- The Firebase web config in `js/config.js` is public by design. Never commit service-account keys.
