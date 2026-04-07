# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Doffin Scout is a GitHub Actions workflow that runs every Monday at 07:00 UTC (08:00 CET / 09:00 CEST). It:
1. Fetches active public procurements from the Doffin API for the previous 7 days (Mon–Sun), filtered to Oslo og Viken (`NO08`) and notices without a specified region (`anyw`)
2. Sends all notices in a single Claude call to categorize opportunities for SoCentral AS
3. Sends a formatted plain-text-style HTML email digest via Resend

## Commands

```bash
# Run manually (requires .env with all five env vars)
node run.mjs

# Preview email design
open preview.html
```

## Architecture

The workflow is triggered by `.github/workflows/doffin-scout.yml`, which runs `node run.mjs`. The function logic lives in `src/doffin-scout.mjs`.

### `src/doffin-scout.mjs` — the entire function

Sections (separated by comment banners):

- **Config** – `SOCENTRAL_CONTEXT`, `CLAUDE_SYSTEM_PROMPT`. Tune the Claude analysis prompt here.
- **`handler()`** – orchestrates: get 7 dates → fetch all days in parallel → single Claude call for all notices → email.
- **`getWeekDates()`** – returns an array of 7 ISO date strings for Mon–Sun of last week (Oslo timezone).
- **`getISOWeekNumber()`** – returns the ISO week number for a date string.
- **`fetchDoffinNotices(date)`** – calls `https://api.doffin.no/public/v2/search` with `location=NO08&location=anyw` and a single date. Uses the `Ocp-Apim-Subscription-Key` header.
- **`analyzeWithClaude(notices, weekStart, weekEnd)`** – calls the Anthropic Messages API directly via `fetch` (no SDK). Uses `claude-sonnet-4-6`, `max_tokens: 8000`. Returns `{ cards, maybeCards }`.
- **`sendEmail(subject, html)`** – calls the Resend API. Recipients are read from `EMAIL_TO` (comma-separated).
- **`formatEmailHtml(cards, maybeCards, totalCount, weekStart, weekEnd)`** – builds a plain-text-style HTML email (no tables, `<body>` is the email, `max-width: 600px`). Dark mode supported via `@media (prefers-color-scheme: dark)` in `<head>`.

### Rate limiting

All notices from the full week are sent in a single Claude call (no per-day loop or sleep). On 429 errors the function retries up to 3 times with exponential backoff (60s, 120s, 180s).

### Analysis categories

Claude sorts each procurement into one of three categories:

| Category | JSON field | Description |
|---|---|---|
| Relevant | `cards` | Clear match – SoCentral can deliver without major adaptation |
| Maybe relevant | `maybeCards` | Tangentially related – worth a look, but requires interpretation or partnership |
| Not relevant | _(excluded)_ | Clearly outside SoCentral's mandate |

### Email structure

1. **Eyebrow** – week number and region scope
2. **Date heading** – `24. mars – 30. mars` (no year)
3. **Lede** – total count + how many relevant/maybe
4. **Relevante muligheter** – green section header, full cards
5. **Kan være relevant** – blue section header, full cards
6. **Se alle utlysninger** – two Doffin search links (Oslo+Viken filtered, and all regions), both with `status=ACTIVE`
7. **Footer**

### Doffin API

- Endpoint: `https://api.doffin.no/public/v2/search`
- Auth header: `Ocp-Apim-Subscription-Key`
- Location filter: `params.append("location", "NO08")` / `params.append("location", "anyw")` — use `append()` for repeated keys
- Key params: `issueDateFrom`, `issueDateTo`, `status=ACTIVE`, `numHitsPerPage` (set to 200), `sortBy`

### Doffin web search URL format

```
https://doffin.no/search?page=1&location=NO08%2Canyw&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&status=ACTIVE
```

### Required environment variables

| Variable | Purpose |
|---|---|
| `DOFFIN_API_KEY` | Doffin API subscription key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `RESEND_API_KEY` | Resend.com API key |
| `EMAIL_FROM` | Verified sender address in Resend |
| `EMAIL_TO` | Comma-separated recipient addresses |

Set as repository secrets in GitHub for production, or in `.env` for local runs.

### Tech stack

- ESM (`"type": "module"`) — use `.mjs` extension or ES module imports
- No bundler
- No test framework
- Cron schedule: `0 7 * * 1` (Mondays 07:00 UTC) — defined in `.github/workflows/doffin-scout.yml`

## Customization points

- **Region filter**: `location` params in `fetchDoffinNotices()` — `NO08` = Oslo og Viken (NUTS2 region), `anyw` = not specified
- **Relevance criteria**: `SOCENTRAL_CONTEXT` and `CLAUDE_SYSTEM_PROMPT`
- **Schedule**: cron string in `.github/workflows/doffin-scout.yml`
- **Recipients**: `EMAIL_TO` env var / secret (comma-separated)
