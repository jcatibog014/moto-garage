# AGENTS.md

This file guides AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository.

## Overview

Moto Garage is a unit tracker for a motorcycle and car buy-and-sell business. It is plain HTML, CSS and JavaScript with no build step, package manager or tests. Data lives in Supabase and is accessed from the browser with `@supabase/supabase-js`, which is loaded from jsDelivr at a pinned version in `index.html`.

Run it locally with `npx serve .` (Python is not installed on the owner's machine).

## Architecture

- `js/app.js` is one IIFE: formatting helpers, a hash router (`#/`, `#/units`, `#/units/new`, `#/units/:id`, `#/units/:id/edit`), and a `render*` function for each view that writes `view.innerHTML` and then attaches listeners. Escape all user data with `esc()` before putting it in a template.
- `routeToken` / `stale(token)` drop renders that finish after the user has already navigated away. Every async render checks `stale(token)` after awaiting.
- `onAuthStateChange` re-routes only on `INITIAL_SESSION` or when the user signs in or out, not on token refreshes, so open forms aren't wiped.
- Reads go through the `unit_summary` view, which adds `total_expenses`, `total_cost`, `profit` and `days_in_stock`. Writes go to the `units` and `expenses` tables. If you add a column to `units`, the view picks it up through `u.*`, but you need to recreate the view in Supabase.
- Form validation: `field()` renders an input plus a `<p class="error" id="{name}-error">`. `validate(form, extra)` uses native constraint validity and an optional `{ name: value => message }` map. `formValues()` converts the names in `NUMERIC` to numbers and blank values to `null`.
- Enum values (`type`, `status`, expense `category`) are defined twice: as check constraints in `supabase/schema.sql` and as the `TYPES`/`STATUS`/`CATEGORIES` maps in `app.js`. Change both together.

## Conventions

- Money is PHP, formatted with `Intl.NumberFormat('en-PH', { currency: 'PHP' })` through `money()` and `signed()`.
- Dates are `YYYY-MM-DD` strings. `today()` returns the local date, not UTC.
- Colors are CSS variables on `:root`. Use `color-mix(in srgb, …)`. The layout is mobile-first, with breakpoints at 640, 768 and 1024px at the end of `styles.css`.
- Never commit a Supabase `service_role`/secret key. Only the anon/publishable key belongs in `js/config.js`.
