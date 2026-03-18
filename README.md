# Doffin Scout

Daglig Doffin-scanner for SoCentral. Kjører kl. 09:00 Oslo-tid, henter aktive offentlige anskaffelser (100k–50M NOK), analyserer dem med Claude, og sender en e-postdigest til mottakerlisten.

## Miljøvariabler

| Variabel | Beskrivelse |
|---|---|
| `DOFFIN_API_KEY` | Doffin Beta API subscription key |
| `ANTHROPIC_API_KEY` | Anthropic API-nøkkel |
| `RESEND_API_KEY` | Resend.com API-nøkkel |
| `EMAIL_FROM` | Avsenderadresse (må være verifisert i Resend) |
| `EMAIL_TO` | Mottakere, kommaseparert |

Kopier `.env.example` til `.env` og fyll inn verdiene for lokal kjøring.

## Kjøre lokalt

```bash
npm install
netlify functions:invoke doffin-scout --no-identity
```

## Deploy

Koble GitHub-repoet til Netlify. Funksjonen plukkes opp automatisk via `netlify.toml`. Legg inn miljøvariablene under **Site Settings → Environment Variables** og deploy på nytt.

## Tilpasning

| Hva | Hvor |
|---|---|
| Søkeparametere (verdigrense, antall) | `DOFFIN_PARAMS` |
| Relevanskriterier og SoCentral-beskrivelse | `SOCENTRAL_CONTEXT` + `CLAUDE_SYSTEM_PROMPT` |
| Tidspunkt | cron-uttrykket i `export const config` |
| Mottakere | `EMAIL_TO` i `.env` / Netlify-miljøvariabler |

## Kostnadsestimat

~$0.02/dag (Claude Sonnet 4.6, 20 anskaffelser). Doffin API, Resend og Netlify Functions er gratis på dette volumet.

## Filstruktur

```
doffin-scout/
├── netlify/functions/doffin-scout.mjs   # Hele funksjonen
├── netlify.toml
├── package.json
├── .env.example
└── .gitignore
```
