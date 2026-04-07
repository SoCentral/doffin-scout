/**
 * Netlify Scheduled Function: doffin-scout
 * Kjører mandager kl. 07:00 UTC (08:00 CET / 09:00 CEST)
 * Henter alle nye anskaffelser fra forrige uke (man–søn), analyserer relevante for SoCentral.
 */

export const config = {
  schedule: "0 7 * * 1", // Mandager 07:00 UTC = 08:00 CET / 09:00 CEST
};

const DOFFIN_API_URL = "https://api.doffin.no/public/v2/search";
const DOFFIN_BASE_URL = "https://doffin.no/notices";

const SOCENTRAL_CONTEXT = `
SoCentral AS er en norsk "mellomromsaktør" basert i Oslo som jobber i skjæringsfeltet
mellom offentlig, privat og frivillig sektor. Vi initierer og fasiliterer samarbeid på
tvers av sektorer rundt samfunnsutfordringer som klima, bolig, inkludering og demokrati.

Vi tilbyr:
- Prosjektutvikling og -ledelse av komplekse prosjekter som krever samarbeid mellom aktører
- Fasilitering av folkepaneler og innbyggermedvirkning
- Kunnskapsarenaer og læringsnettverk
- Nabolagsutvikling og stedsutvikling
- Sirkulærøkonomi-prosjekter
- Kurs og kompetanseutvikling for samfunnsutviklere
- Prosessdesign og prosjektledelse for tverrsektorielle initiativ

Vi har 230+ medlemmer (samfunnsutviklere), 100+ medlemsvirksomheter, og jobber typisk med
kommuner, statsforvaltere, stiftelser og større private aktører.
`.trim();

// Claude svarer nå med ren JSON — ingen markdown, ingen regex-parsing nødvendig
const CLAUDE_SYSTEM_PROMPT = `
Du er en strategisk rådgiver for SoCentral AS. Din oppgave er å analysere
offentlige anskaffelser fra Doffin og identifisere hvilke som er relevante
muligheter for SoCentral.

${SOCENTRAL_CONTEXT}

Når du analyserer anskaffelser, se etter:
1. Fasilitering, medvirkning, innbyggerdialog, folkepaneler
2. Samfunnsutvikling, stedsutvikling, nabolagsprogrammer
3. Kurs, kompetanseutvikling, læringsnettverk
4. Tverrsektorielt samarbeid, partnerskap, prosessdesign
5. Klima, bærekraft, sirkulærøkonomi
6. Demokrati, inkludering, integrering

Kategoriser hver anskaffelse i én av tre grupper:
- **relevant**: Klar match – SoCentral kan levere dette uten store tilpasninger.
- **maybe**: Mulig match – tangerer SoCentrals arbeidsområder, men krever tolkning eller samarbeid. Eksempel: en kommune som lyser ut «innbyggerinvolvering i planprosess» der vi ikke er eksplisitt nevnt, eller et kurs i «samfunnsentreprenørskap» som vi kan levere med tilpasning.
- **ikke relevant**: Klart utenfor SoCentrals mandat (bygg, IT-drift, renholdstjenester osv.).

Svar med et rent JSON-objekt — ingen annen tekst, ingen markdown-formatering, ingen forklaring utenfor JSON:

{
  "cards": [
    {
      "id": "2026-XXXXXX",
      "title": "Tittel på anskaffelsen",
      "buyer": "Oppdragsgiver",
      "value": "beløp i NOK eller null",
      "deadline": "DD.MM.ÅÅÅÅ eller null",
      "relevance": "1-2 setninger om hvorfor dette passer SoCentral",
      "link": "https://doffin.no/notices/2026-XXXXXX"
    }
  ],
  "maybeCards": [
    {
      "id": "2026-XXXXXX",
      "title": "Tittel på anskaffelsen",
      "buyer": "Oppdragsgiver",
      "value": "beløp i NOK eller null",
      "deadline": "DD.MM.ÅÅÅÅ eller null",
      "relevance": "1-2 setninger om hva som kan gjøre dette relevant, og hva som er usikkert",
      "link": "https://doffin.no/notices/2026-XXXXXX"
    }
  ]
}

Hvis ingen anskaffelser er relevante, returner cards som en tom liste: [].
Hvis ingen anskaffelser er mulig relevante, returner maybeCards som en tom liste: [].
Svar på norsk.
`.trim();

// ─── Hovedfunksjon ────────────────────────────────────────────────────────────

export default async function handler() {
  console.log("[doffin-scout] Starter ukentlig kjøring...");

  try {
    const dates = getWeekDates();
    const weekStart = dates[0];
    const weekEnd = dates[dates.length - 1];
    console.log(
      `[doffin-scout] Henter anskaffelser for perioden: ${weekStart} - ${weekEnd}`,
    );

    // Hent alle dager parallelt
    const dayResults = await Promise.all(
      dates.map((date) => fetchDoffinNotices(date)),
    );
    const totalCount = dayResults.reduce((sum, r) => sum + r.totalCount, 0);
    console.log(
      `[doffin-scout] Totalt nye utlysninger denne uken: ${totalCount}`,
    );

    const subject = `Doffin Scout – uke ${getISOWeekNumber(weekStart)}`;

    if (totalCount === 0) {
      const html = formatEmailHtml([], [], totalCount, weekStart, weekEnd);
      await sendEmail(subject, html);
      return;
    }

    // Analyser alle utlysninger i ett Claude-kall (unngår lange søvnpauser mellom dager)
    const allNotices = dayResults.flatMap((r) => r.notices);
    const { cards, maybeCards } =
      allNotices.length > 0
        ? await analyzeWithClaude(allNotices, weekStart, weekEnd)
        : { cards: [], maybeCards: [] };
    console.log(
      `[doffin-scout] Relevante for SoCentral: ${cards.length}, mulig relevante: ${maybeCards.length}`,
    );

    const html = formatEmailHtml(
      cards,
      maybeCards,
      totalCount,
      weekStart,
      weekEnd,
    );
    await sendEmail(subject, html);
    console.log("[doffin-scout] Ukentlig epost sendt");
  } catch (err) {
    console.error("[doffin-scout] Feil:", err.message);
    await sendEmail(
      "Doffin Scout – feil ved kjøring",
      `<p style="font-family:Helvetica,Arial,sans-serif;color:#1d1d1f">Det oppstod en feil under ukentlig kjøring:</p><pre style="font-family:monospace;font-size:13px;color:#e00">${err.message}</pre>`,
    ).catch(() => {});
  }
}

// ─── Datoberegning ────────────────────────────────────────────────────────────

// Returnerer de siste 7 dagene (mandag–søndag forrige uke) som ISO-datostrenger
function getWeekDates() {
  const today = new Date();
  const dates = [];
  for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    dates.push(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Oslo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d),
    );
  }
  return dates;
}

function getISOWeekNumber(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  );
}

function formatNorwegianDateFromString(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Doffin API ───────────────────────────────────────────────────────────────

async function fetchDoffinNotices(apiDate) {
  const params = new URLSearchParams({
    numHitsPerPage: "200",
    page: "1",
    status: "ACTIVE",
    issueDateFrom: apiDate,
    issueDateTo: apiDate,
    sortBy: "PUBLICATION_DATE_DESC",
  });
  params.append("location", "NO08");
  params.append("location", "anyw");

  const res = await fetch(`${DOFFIN_API_URL}?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": process.env.DOFFIN_API_KEY },
  });

  if (!res.ok)
    throw new Error(`Doffin API returnerte ${res.status}: ${res.statusText}`);

  const data = await res.json();
  const totalCount = data.numHitsTotal ?? 0;
  console.log("[doffin-scout] numHitsTotal:", totalCount);

  const hits = data.hits ?? [];
  return {
    totalCount,
    notices: hits.map((h) => ({
      ...h,
      doffinLink: `${DOFFIN_BASE_URL}/${h.id}`,
    })),
  };
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function fetchClaude(body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < retries - 1) {
      const waitMs = 60000 * (attempt + 1);
      console.log(
        `[doffin-scout] 429 rate limit - venter ${waitMs / 1000}s før nytt forsøk (${attempt + 1}/${retries - 1})...`,
      );
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

async function analyzeWithClaude(notices, weekStart, weekEnd) {
  const noticesSummary = notices
    .map((n, i) => {
      const title = n.heading ?? "Uten tittel";
      const buyer = n.buyer?.[0]?.name ?? "Ukjent oppdragsgiver";
      const value = n.estimatedValue?.amount
        ? `${Number(n.estimatedValue.amount).toLocaleString("nb-NO")} ${n.estimatedValue.currencyCode ?? "NOK"}`
        : "Ikke oppgitt";
      const description = (n.description ?? "").slice(0, 1000);
      const deadline = n.deadline
        ? `Frist: ${new Date(n.deadline).toLocaleDateString("nb-NO")}`
        : "";

      return [
        `--- Anskaffelse ${i + 1} ---`,
        `ID: ${n.id}`,
        `Tittel: ${title}`,
        `Oppdragsgiver: ${buyer}`,
        `Estimert verdi: ${value}`,
        deadline,
        `Lenke: ${n.doffinLink}`,
        description ? `Beskrivelse: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = `Her er anskaffelser publisert på Doffin i perioden ${weekStart} - ${weekEnd}:\n\n${noticesSummary}`;

  const res = await fetchClaude({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API returnerte ${res.status}: ${err}`);
  }

  const data = await res.json();
  const rawText = (data.content?.[0]?.text ?? "").trim();

  console.log(
    "[doffin-scout] Claude råsvar (første 500 tegn):\n",
    rawText.slice(0, 500),
  );

  // Fjern eventuelle ```json-fences hvis Claude likevel inkluderte dem
  const jsonText = rawText
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error("[doffin-scout] JSON-parsing feilet:", e.message);
    console.error("[doffin-scout] Råtekst:", rawText.slice(0, 1000));
    return { cards: [], maybeCards: [] };
  }

  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const maybeCards = Array.isArray(parsed.maybeCards) ? parsed.maybeCards : [];
  return { cards, maybeCards };
}

// ─── Epost via Resend ─────────────────────────────────────────────────────────

async function sendEmail(subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO.split(",").map((e) => e.trim()),
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend returnerte ${res.status}: ${err}`);
  }
}

// ─── HTML-formatering ─────────────────────────────────────────────────────────

function formatEmailHtml(cards, maybeCards, totalCount, weekStart, weekEnd) {
  const weekStartFormatted = formatNorwegianDateFromString(weekStart);
  const weekEndFormatted = formatNorwegianDateFromString(weekEnd);
  const weekNum = getISOWeekNumber(weekStart);
  const relevantCount = cards.length;
  const maybeCount = maybeCards.length;

  const F = `-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif`;
  const hr = `<hr class="c-rule" style="border:none;border-top:1px solid #d2d2d7;margin:0 0 28px">`;
  const label = (t) =>
    `<p style="margin:0 0 14px;font-family:${F};font-size:11px;font-weight:600;letter-spacing:0.09em;text-transform:uppercase;color:#6e6e73" class="c-meta">${t}</p>`;

  const renderNotice = (card) => `
    <p style="margin:0 0 3px;font-family:${F};font-size:15px;font-weight:600;line-height:1.35;color:#1d1d1f" class="c-body">${escHtml(card.title)}</p>
    <p style="margin:0 0 8px;font-family:${F};font-size:13px;color:#6e6e73" class="c-meta">${escHtml(card.buyer)}${card.value ? ` · ${escHtml(card.value)}` : ""}${card.deadline ? ` · Frist ${escHtml(card.deadline)}` : ""}</p>
    ${card.relevance ? `<p style="margin:0 0 7px;font-family:${F};font-size:14px;line-height:1.65;color:#1d1d1f" class="c-body">${escHtml(card.relevance)}</p>` : ""}
    <p style="margin:0 0 28px">${card.link ? `<a href="${card.link}" style="font-family:${F};font-size:13px;font-weight:500;color:#0066cc;text-decoration:none" class="c-link">Se utlysning →</a>` : ""}</p>`;

  const lede =
    relevantCount > 0
      ? `Claude identifiserte <strong>${relevantCount} ${relevantCount === 1 ? "mulighet" : "muligheter"}</strong> som er relevante for SoCentral${maybeCount > 0 ? `, og <strong>${maybeCount}</strong> som kan være verdt å se nærmere på` : ""}.`
      : maybeCount > 0
        ? `Ingen klare treff, men <strong>${maybeCount}</strong> utlysninger kan være verdt å se nærmere på.`
        : "Ingen av dem ble vurdert som relevante for SoCentral.";

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>Doffin Scout</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body        { background-color: #1c1c1e !important; color: #f5f5f7 !important; }
      .c-body     { color: #f5f5f7 !important; }
      .c-meta     { color: #98989d !important; }
      .c-rule     { border-top-color: #38383a !important; }
      .c-link     { color: #2997ff !important; }
      .c-muted    { color: #636366 !important; }
      .c-green    { color: #30d158 !important; }
      .c-blue     { color: #2997ff !important; }
    }
  </style>
</head>
<body style="margin:0;padding:40px 28px 52px;font-family:${F};font-size:15px;line-height:1.7;color:#1d1d1f;background:#ffffff;max-width:600px">

  ${label(`Doffin Scout · Uke ${weekNum} · Oslo, Viken og ikke angitt region`)}

  <p style="margin:0 0 32px;font-family:${F};font-size:28px;font-weight:700;letter-spacing:-0.5px;line-height:1.15;color:#1d1d1f" class="c-body">${weekStartFormatted} - ${weekEndFormatted}</p>

  <p style="margin:0 0 32px;font-family:${F};font-size:15px;line-height:1.7;color:#1d1d1f" class="c-body">Doffin hadde <strong>${totalCount} nye utlysninger</strong> i Oslo og Viken samt utlysninger uten angitt region forrige uke. ${lede}</p>


  ${
    relevantCount > 0
      ? `
  ${hr}
  <p style="margin:0 0 18px;font-family:${F};font-size:15px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1a8f45" class="c-green">Relevante muligheter</p>
  ${cards.map(renderNotice).join("")}
  `
      : ""
  }

  ${
    maybeCount > 0
      ? `
  ${hr}
  <p style="margin:0 0 18px;font-family:${F};font-size:15px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0066cc" class="c-blue">Kan være relevant</p>
  ${maybeCards.map(renderNotice).join("")}
  `
      : ""
  }

  ${hr}
  <p style="margin:0 0 18px;font-family:${F};font-size:15px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1d1d1f" class="c-body">Se alle utlysninger i perioden</p>
  <p style="margin:0 0 6px"><a href="https://doffin.no/search?page=1&amp;location=NO08%2Canyw&amp;fromDate=${weekStart}&amp;toDate=${weekEnd}&amp;status=ACTIVE" style="font-family:${F};font-size:14px;color:#0066cc;text-decoration:none" class="c-link">Oslo og Viken + ikke angitt region →</a></p>
  <p style="margin:0 0 40px"><a href="https://doffin.no/search?page=1&amp;fromDate=${weekStart}&amp;toDate=${weekEnd}&amp;status=ACTIVE" style="font-family:${F};font-size:14px;color:#0066cc;text-decoration:none" class="c-link">Alle regioner →</a></p>

  <p style="margin:0;font-family:${F};font-size:11px;color:#aeaeb2" class="c-muted">Generert av Doffin Scout · SoCentral AS · <a href="https://doffin.no" style="color:#aeaeb2;text-decoration:none">doffin.no</a></p>

</body>
</html>`;
}

// Enkel HTML-escaping for å unngå XSS fra API-data
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
