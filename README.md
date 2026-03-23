# Doffin Scout

Ukentlig Doffin-scanner for SoCentral. Kjører mandager kl. 08:00 Oslo-tid (07:00 UTC), henter aktive offentlige anskaffelser fra Oslo og Viken (`NO08`) samt utlysninger uten angitt region (`anyw`) for hele forrige uke, analyserer dem med Claude og sender en e-postdigest til mottakerlisten.

## Miljøvariabler

| Variabel | Beskrivelse |
|---|---|
| `DOFFIN_API_KEY` | Doffin API subscription key |
| `ANTHROPIC_API_KEY` | Anthropic API-nøkkel |
| `RESEND_API_KEY` | Resend.com API-nøkkel |
| `EMAIL_FROM` | Avsenderadresse (må være verifisert i Resend) |
| `EMAIL_TO` | Mottakere, kommaseparert |

Kopier `.env.example` til `.env` og fyll inn verdiene for lokal kjøring.

## Kjøre lokalt

```bash
npm install

# Manuell kjøring (anbefalt – ingen timeout)
node run.mjs
```

Funksjonen tar ~8 minutter å kjøre (7 sekvensielle Claude-kall med 65 sekunders pause mellom for å overholde rate limit). Ved 429-feil fra Claude API forsøker den automatisk på nytt opptil 3 ganger med eksponentiell backoff.

> **Ikke bruk** `netlify functions:invoke` for manuell kjøring – det har en 30-sekunders timeout som avbryter funksjonen. Bruk `node run.mjs` i stedet. Cron-jobben på Netlify kjøres som background function og er ikke påvirket av denne begrensningen.

## Feilsøking

```bash
# Sjekk hvilke utlysninger som hentes for en gitt periode
node debug.mjs 2026-03-16 2026-03-22
```

`debug.mjs` bruker samme parametere som produksjonsfunksjonen (NO08 + anyw, 200 per dag) og lister alle utlysninger med tittel, oppdragsgiver og lenke.

## Forhåndsvisning av e-post

Åpne `preview.html` i en nettleser for å se hvordan e-posten ser ut med eksempeldata.

## Deploy

Koble GitHub-repoet til Netlify. Funksjonen plukkes opp automatisk via `netlify.toml`. Legg inn miljøvariablene under **Site Settings → Environment Variables** og deploy på nytt.

## Tilpasning

| Hva | Hvor |
|---|---|
| Regionsfilter | `location`-parametere i `fetchDoffinNotices()` — `NO08` = Oslo og Viken (NUTS2), `anyw` = ikke angitt region |
| Relevanskriterier og SoCentral-beskrivelse | `SOCENTRAL_CONTEXT` + `CLAUDE_SYSTEM_PROMPT` |
| Tidspunkt | cron-uttrykket i `export const config` |
| Mottakere | `EMAIL_TO` i `.env` / Netlify-miljøvariabler |

## Kostnadsestimat

~$0.25–0.35/uke (Claude Sonnet 4.6, 7 daglige analysekall + 1 syntesekall). Doffin API, Resend og Netlify Functions er gratis på dette volumet.

## Filstruktur

```
doffin-scout/
├── netlify/functions/doffin-scout.mjs   # Hele funksjonen
├── run.mjs                               # Manuell kjøring uten Netlify-timeout
├── debug.mjs                             # Feilsøkingsscript for API-kall
├── preview.html                          # Statisk e-postforhåndsvisning
├── netlify.toml
├── package.json
├── .env.example
└── .gitignore
```
