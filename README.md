# Doffin Scout

Ukentlig Doffin-scanner for SoCentral. Kjører mandager kl. 08:00 Oslo-tid (07:00 UTC) via GitHub Actions, henter aktive offentlige anskaffelser fra Oslo og Viken (`NO08`) samt utlysninger uten angitt region (`anyw`) for hele forrige uke, analyserer dem med Claude og sender en e-postdigest til mottakerlisten.

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
# Manuell kjøring
node run.mjs
```

## Deploy (GitHub Actions)

1. Legg inn de fem miljøvariablene som **repository secrets** under **Settings → Secrets and variables → Actions**
2. Push til `main` — workflowen plukkes opp automatisk
3. For å kjøre manuelt: **Actions → Doffin Scout → Run workflow**

Workflowen ligger i `.github/workflows/doffin-scout.yml`.

## Feilsøking

```bash
# Sjekk hvilke utlysninger som hentes for en gitt periode
node debug.mjs 2026-03-16 2026-03-22
```

`debug.mjs` bruker samme parametere som produksjonsfunksjonen (NO08 + anyw, 200 per dag) og lister alle utlysninger med tittel, oppdragsgiver og lenke.

## Forhåndsvisning av e-post

Åpne `preview.html` i en nettleser for å se hvordan e-posten ser ut med eksempeldata.

## Tilpasning

| Hva | Hvor |
|---|---|
| Regionsfilter | `location`-parametere i `fetchDoffinNotices()` — `NO08` = Oslo og Viken (NUTS2), `anyw` = ikke angitt region |
| Relevanskriterier og SoCentral-beskrivelse | `SOCENTRAL_CONTEXT` + `CLAUDE_SYSTEM_PROMPT` |
| Tidspunkt | cron-uttrykket i `.github/workflows/doffin-scout.yml` |
| Mottakere | `EMAIL_TO` i secrets / `.env` |

## Kostnadsestimat

~$0.10–0.20/uke (Claude Sonnet 4.6, ett enkelt Claude-kall per uke). Doffin API, Resend og GitHub Actions er gratis på dette volumet.

## Filstruktur

```
doffin-scout/
├── .github/workflows/doffin-scout.yml   # GitHub Actions cron-workflow
├── src/doffin-scout.mjs                  # Funksjonslogikken
├── run.mjs                               # Inngangspunkt for lokal og CI-kjøring
├── debug.mjs                             # Feilsøkingsscript for API-kall
├── preview.html                          # Statisk e-postforhåndsvisning
├── package.json
├── .env.example
└── .gitignore
```
