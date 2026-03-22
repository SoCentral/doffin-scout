# Doffin Scout

Ukentlig Doffin-scanner for SoCentral. Kjører mandager kl. 08:00 Oslo-tid (07:00 UTC), henter aktive offentlige anskaffelser fra Oslo og Viken samt utlysninger uten angitt region for hele forrige uke, analyserer dem med Claude og sender en e-postdigest til mottakerlisten.

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
netlify dev        # start lokal dev-server
netlify functions:invoke doffin-scout --no-identity
```

Funksjonen tar ~2 minutter å kjøre lokalt (7 sekvensielle Claude-kall med pause mellom for å overholde rate limit).

## Forhåndsvisning av e-post

Åpne `preview.html` i en nettleser for å se hvordan e-posten ser ut med eksempeldata.

## Deploy

Koble GitHub-repoet til Netlify. Funksjonen plukkes opp automatisk via `netlify.toml`. Legg inn miljøvariablene under **Site Settings → Environment Variables** og deploy på nytt.

## Tilpasning

| Hva | Hvor |
|---|---|
| Regionsfilter (Doffin API) | `location`-parametere i `fetchDoffinNotices()` |
| Relevanskriterier og SoCentral-beskrivelse | `SOCENTRAL_CONTEXT` + `CLAUDE_SYSTEM_PROMPT` |
| Tidspunkt | cron-uttrykket i `export const config` |
| Mottakere | `EMAIL_TO` i `.env` / Netlify-miljøvariabler |

## Kostnadsestimat

~$0.10–0.20/uke (Claude Sonnet 4.6, 7 kall à ~30–50 utlysninger + 1 syntesekall for ukessammendrag). Doffin API, Resend og Netlify Functions er gratis på dette volumet.

## Filstruktur

```
doffin-scout/
├── netlify/functions/doffin-scout.mjs   # Hele funksjonen
├── preview.html                          # Statisk e-postforhåndsvisning
├── netlify.toml
├── package.json
├── .env.example
└── .gitignore
```
