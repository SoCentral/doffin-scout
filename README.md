# Doffin Scout 🔍

Daglig Doffin-scanner for SoCentral. Kjører kl. 09:00 Oslo-tid, henter aktive 
offentlige anskaffelser (1M–1B NOK), analyserer dem med Claude, og sender 
relevante muligheter til thomas.evensen@socentral.no på epost.

---

## Innhold

- [Forutsetninger](#forutsetninger)
- [Steg 1 – Sett opp GitHub-repo under SoCentral](#steg-1--sett-opp-github-repo-under-socentral)
- [Steg 2 – Sett opp API-nøkler](#steg-2--sett-opp-api-nøkler)
- [Steg 3 – Deploy til Netlify](#steg-3--deploy-til-netlify)
- [Steg 4 – Sett inn miljøvariabler i Netlify](#steg-4--sett-inn-miljøvariabler-i-netlify)
- [Steg 5 – Verifiser at det fungerer](#steg-5--verifiser-at-det-fungerer)
- [Kostnadsoversikt](#kostnadsoversikt)
- [Tilpasning](#tilpasning)

---

## Forutsetninger

- GitHub-konto med tilgang til SoCentral-organisasjonen
- Netlify-konto (gratis tier er nok)
- Node.js 18+ installert lokalt (valgfritt, for lokal testing)

---

## Steg 1 – Sett opp GitHub-repo under SoCentral

### 1a. Fork / opprett repo

1. Gå til [github.com/SoCentral](https://github.com/SoCentral)
2. Klikk **New repository**
3. Navn: `doffin-scout`
4. Sett til **Private** (inneholder API-nøkler via Netlify, men vær forsiktig)
5. Klikk **Create repository**

### 1b. Last opp koden

```bash
# Klon det tomme repoet
git clone https://github.com/SoCentral/doffin-scout.git
cd doffin-scout

# Kopier inn filene du fikk fra Claude
cp -r /path/to/doffin-scout/* .

# Sørg for at .env IKKE er med (den er i .gitignore)
git add .
git commit -m "Initial: Doffin Scout scheduled function"
git push origin main
```

---

## Steg 2 – Sett opp API-nøkler

Du trenger tre API-nøkler. Her er hvordan du skaffer dem:

### Anthropic API-nøkkel

1. Gå til [console.anthropic.com](https://console.anthropic.com)
2. Opprett konto (eller logg inn)
3. Gå til **API Keys** → **Create Key**
4. Gi den et navn, f.eks. `doffin-scout-socentral`
5. Kopier nøkkelen (vises kun én gang) – den starter med `sk-ant-...`
6. Gå til **Billing** og legg inn betalingskort
   - Du faktureres kun for faktisk bruk (se kostnadsoversikt nedenfor)
   - Anbefalt: Sett et månedlig budsjettvarsel under **Billing → Usage limits**

### Resend API-nøkkel (for utsending av epost)

[Resend](https://resend.com) er en enkel epost-API som er gratis inntil 3 000 epost/måned.

1. Gå til [resend.com](https://resend.com) og opprett konto
2. Gå til **Domains** → **Add Domain**
3. Legg til `socentral.no` og følg instruksjonene for DNS-verifisering
   (du må legge inn noen TXT/MX-records hos domeneleverandøren)
4. Gå til **API Keys** → **Create API Key**
5. Kopier nøkkelen – den starter med `re_...`

> **Tips:** Hvis du ikke ønsker å sette opp et domene nå, kan du bruke
> Resends test-adresse `onboarding@resend.dev` som avsender og sende til
> din egen epost under testing. Bytt til `scout@socentral.no` når domenet er verifisert.

### Doffin API-nøkkel

Du har allerede denne: `0230e8a22fe44017a982ad6a91c056bf`  
⚠️ Denne er nå eksponert i en chat – anbefalt å regenerere den i Doffin-portalen.

---

## Steg 3 – Deploy til Netlify

### 3a. Koble GitHub til Netlify

1. Gå til [app.netlify.com](https://app.netlify.com) og logg inn
2. Klikk **Add new site** → **Import an existing project**
3. Velg **GitHub** og autoriser Netlify
4. Finn og velg `SoCentral/doffin-scout`
5. Build-innstillinger:
   - **Build command:** (tom – vi har ingen frontend)
   - **Publish directory:** (tom)
6. Klikk **Deploy site**

Netlify vil nå deploye. Siden det ikke er noen frontend, vil siden vise en 404 – det er OK. Funksjonen er det viktige.

### 3b. Aktiver Netlify Functions (er automatisk via netlify.toml)

Netlify oppdager `netlify/functions/`-mappen automatisk basert på `netlify.toml`.

---

## Steg 4 – Sett inn miljøvariabler i Netlify

1. Gå til **Site Settings** → **Environment variables**
2. Klikk **Add a variable** for hver av disse:

| Variabel | Verdi |
|---|---|
| `DOFFIN_API_KEY` | Din Doffin subscription key |
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `RESEND_API_KEY` | `re_...` |
| `EMAIL_FROM` | `Doffin Scout <scout@socentral.no>` |
| `EMAIL_TO` | `thomas.evensen@socentral.no` |

3. Etter at alle variabler er lagt inn: gå til **Deploys** → **Trigger deploy** → **Deploy site**
   (Netlify må redeployeres for å plukke opp de nye variablene)

---

## Steg 5 – Verifiser at det fungerer

### Test funksjonen manuelt

```bash
# Installer Netlify CLI
npm install -g netlify-cli

# I prosjektmappen:
netlify login
netlify link  # Koble til ditt Netlify-site

# Kjør funksjonen lokalt (krever .env-fil)
cp .env.example .env
# Fyll inn verdiene i .env-filen

netlify functions:invoke doffin-scout --no-identity
```

### Verifiser schedule i Netlify-dashboardet

1. Gå til **Functions** i Netlify-dashboardet
2. Klikk på `doffin-scout`
3. Du skal se **Scheduled function** med cron `0 7 * * *`
4. Under **Function log** kan du se historikk etter at den har kjørt

### Scheduled functions i Netlify

Netlify kjører scheduled functions via deres interne cron-system.  
Cron-uttrykket `0 7 * * *` betyr: hvert dag kl. 07:00 UTC = **09:00 Oslo-tid**.

---

## Kostnadsoversikt

### Per daglig kjøring (estimat)

| Komponent | Forbruk | Kostnad |
|---|---|---|
| **Doffin API** | 1 kall/dag | Gratis |
| **Claude API** (input) | ~3 000 tokens (20 anskaffelser + system prompt) | ~$0.009 |
| **Claude API** (output) | ~800 tokens (analyse) | ~$0.012 |
| **Resend** | 1 epost/dag | Gratis (under 3000/mnd) |
| **Netlify Functions** | 1 kjøring/dag | Gratis (125k gratis/mnd) |
| **Totalt per dag** | | **~$0.02** |
| **Totalt per måned** | | **~$0.60** |
| **Totalt per år** | | **~$7** |

> Prisene er basert på Claude Sonnet 4.6: $3/1M input-tokens og $15/1M output-tokens.
> Faktisk forbruk varierer med antall og lengde på Doffin-anskaffelsene.

### API-priser (Claude Sonnet 4.6, per mars 2026)
- Input: **$3 per 1 million tokens**
- Output: **$15 per 1 million tokens**

For mer info: [anthropic.com/pricing](https://www.anthropic.com/pricing)

---

## Tilpasning

**Endre antall anskaffelser:** Juster `numHitsPerPage` i `DOFFIN_PARAMS`  
**Endre verdigrenser:** Juster `estimatedValueFrom` / `estimatedValueTo`  
**Endre tidspunkt:** Rediger cron-uttrykket i `export const config`  
**Justere analyseprompt:** Rediger `CLAUDE_SYSTEM_PROMPT`  
**Legge til flere mottakere:** Legg til epostadresser i `to`-arrayen i `sendEmail()`

---

## Filstruktur

```
doffin-scout/
├── netlify/
│   └── functions/
│       └── doffin-scout.mjs   # Scheduled function
├── netlify.toml               # Netlify-konfigurasjon
├── package.json
├── .env.example               # Mal for miljøvariabler
├── .gitignore                 # Ekskluderer .env og node_modules
└── README.md
```
