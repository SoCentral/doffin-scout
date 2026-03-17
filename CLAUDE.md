# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Doffin Scout is a Netlify scheduled function that runs daily at 07:00 UTC (09:00 Oslo time). It:
1. Fetches active public procurements from the Doffin Beta API (Norwegian public tender database)
2. Filters by value range (100k–50M NOK, 20 results per page)
3. Analyzes them with Claude to identify relevant opportunities for SoCentral AS
4. Sends a formatted HTML email digest via Resend

## Commands

```bash
# Install dev dependencies (Netlify CLI)
npm install

# Run locally (requires .env with all five env vars)
npm run dev              # starts netlify dev server
netlify functions:invoke doffin-scout --no-identity  # trigger function manually
```

## Architecture

There is a single source file at `netlify/functions/doffin-scout.mjs`.

### `netlify/functions/doffin-scout.mjs` — the entire function

Sections (separated by comment banners):

- **Config** – `DOFFIN_PARAMS`, `SOCENTRAL_CONTEXT`, `CLAUDE_SYSTEM_PROMPT`. Tune search parameters and the Claude analysis prompt here.
- **`handler()`** – orchestrates the three steps: fetch → analyze → email.
- **`fetchDoffinNotices()`** – calls `https://betaapi.doffin.no/public/v2/search` with the subscription key header `Ocp-Apim-Subscription-Key`.
- **`analyzeWithClaude(notices)`** – calls the Anthropic Messages API directly via `fetch` (no SDK). Uses `claude-sonnet-4-6`, `max_tokens: 1500`.
- **`sendEmail(subject, html)`** – calls the Resend API.
- **`formatEmailHtml(markdownAnalysis, noticeCount)`** – converts Claude's markdown response to inline-styled HTML for email clients.

### Required environment variables

| Variable | Purpose |
|---|---|
| `DOFFIN_API_KEY` | Doffin Beta API subscription key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `RESEND_API_KEY` | Resend.com API key |
| `EMAIL_FROM` | Verified sender address in Resend (e.g. `Doffin Scout <scout@socentral.no>`) |
| `EMAIL_TO` | Recipient address |

### Tech stack

- ESM (`"type": "module"`) — use `.mjs` extension or ES module imports
- No bundler for source; Netlify uses esbuild internally (configured in `netlify.toml`)
- No test framework
- Cron schedule: `0 7 * * *` in `export const config`

## Customization points

- **Search scope**: `DOFFIN_PARAMS` — adjust `numHitsPerPage`, `estimatedValueFrom`, `estimatedValueTo`, `status`
- **Relevance criteria**: `CLAUDE_SYSTEM_PROMPT` — describes SoCentral's services and what to look for
- **Schedule**: `export const config` cron string
- **Multiple recipients**: extend the `to` array in `sendEmail()`
- **Doffin API response shape**: `fetchDoffinNotices()` handles multiple possible response keys (`hits`, `notices`, `results`) since the beta API shape may vary
