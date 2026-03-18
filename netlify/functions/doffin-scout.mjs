/**
 * Netlify Scheduled Function: doffin-scout
 * Kjører daglig kl. 07:00 UTC (09:00 Oslo-tid)
 * Henter alle nye anskaffelser fra i går, analyserer relevante for SoCentral.
 */

export const config = {
  schedule: "0 7 * * *",
};

const DOFFIN_API_URL = "https://api.doffin.no/public/v2/search";
const DOFFIN_BASE_URL = "https://doffin.no/notices";

const SOCENTRAL_CONTEXT = `
SoCentral AS er en norsk "mellomromsaktør" basert i Oslo som jobber i skjæringsfeltet
mellom offentlig, privat og frivillig sektor. Vi initierer og fasiliterer samarbeid på
tvers av sektorer rundt samfunnsutfordringer som klima, bolig, inkludering og demokrati.

Vi tilbyr:
- Fasilitering av folkepaneler og innbyggermedvirkning
- Kunnskapsarenaer og læringsnettverk
- Nabolagsutvikling og stedsutvikling
- Sirkulærøkonomi-prosjekter
- Kurs og kompetanseutvikling for samfunnsutviklere
- Prosessdesign og prosjektledelse for tverrsektorielle initiativ

Vi har 230+ medlemmer (samfunnsutviklere), 100+ partnere, og jobber typisk med
kommuner, statsforvaltere, stiftelser og større private aktører.
`.trim();

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

Svar i NØYAKTIG dette formatet – ikke legg til noe utenfor strukturen:

RELEVANT_IDS: [kommaseparert liste med id-er på relevante anskaffelser, f.eks. "2026-100123,2026-100456"]

## Relevante muligheter

For HVER relevant anskaffelse:
**[Tittel]** – [Oppdragsgiver]
- Estimert verdi: [beløp eller "ikke oppgitt"]
- Søknadsfrist: [dato eller "ikke oppgitt"]
- Relevans: [1-2 setninger om hvorfor dette passer SoCentral]
- 🔗 [Se utlysning på Doffin]([lenke])

## Oppsummering
[2-3 setninger. Hvis ingen relevante: si det tydelig. Hvis ingen relevante, sett RELEVANT_IDS: tom]

Svar på norsk.
`.trim();

// ─── Hovedfunksjon ────────────────────────────────────────────────────────────

export default async function handler() {
  console.log("[doffin-scout] Starter daglig kjøring...");

  try {
    const { apiDate, yesterday } = getDateRange();
    console.log(
      `[doffin-scout] Henter anskaffelser (API-dato: ${apiDate}, norsk dato: ${yesterday})`,
    );

    const { totalCount, notices } = await fetchDoffinNotices(apiDate);
    console.log(
      `[doffin-scout] Totalt nye utlysninger i går: ${totalCount}, hentet: ${notices.length}`,
    );

    const subject = `Doffin Scout – ${formatNorwegianDate(new Date())}`;

    if (notices.length === 0) {
      const html = formatEmailHtml(null, totalCount, 0, [], yesterday);
      await sendEmail(subject, html);
      return;
    }

    const { analysis, relevantIds } = await analyzeWithClaude(
      notices,
      yesterday,
    );
    console.log(
      `[doffin-scout] Relevante for SoCentral: ${relevantIds.length}`,
    );

    // Bygg liste over ALLE ikke-relevante fra faktiske API-data – ingen hallusinering
    const nonRelevant = notices.filter((n) => !relevantIds.includes(n.id));

    const html = formatEmailHtml(
      analysis,
      totalCount,
      relevantIds.length,
      nonRelevant,
      yesterday,
    );
    await sendEmail(subject, html);
    console.log("[doffin-scout] Epost sendt");
  } catch (err) {
    console.error("[doffin-scout] Feil:", err.message);
    await sendEmail(
      "Doffin Scout – feil ved kjøring",
      `<p>Det oppstod en feil under daglig kjøring:</p><pre>${err.message}</pre>`,
    ).catch(() => {});
  }
}

// ─── Datoberegning ────────────────────────────────────────────────────────────

function getDateRange() {
  // Prod-API-et (api.doffin.no) bruker norsk dato direkte i issueDateFrom/To.
  // issueDateFrom=2026-03-17 gir utlysninger publisert norsk 17. mars — ingen offset.
  // Funksjonen kjører kl. 07:00 UTC (09:00 Oslo) → henter gårsdagens utlysninger.
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Norsk dato: bruk Oslo-tid (UTC+1 vinter, UTC+2 sommer)
  const osloDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);

  return {
    apiDate: osloDate, // YYYY-MM-DD i norsk tidssone
    yesterday: osloDate,
  };
}

function formatNorwegianDate(date) {
  return date.toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatNorwegianDateFromString(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Doffin API ───────────────────────────────────────────────────────────────

// Henter alle nye utlysninger fra i går.
// Prod-API-et returnerer full beskrivelse i søkeresultatet — download ikke nødvendig.
async function fetchDoffinNotices(apiDate) {
  const params = new URLSearchParams({
    numHitsPerPage: "100",
    page: "1",
    status: "ACTIVE",
    issueDateFrom: apiDate,
    issueDateTo: apiDate,
    sortBy: "PUBLICATION_DATE_DESC",
  });

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

async function analyzeWithClaude(notices, yesterday) {
  const noticesSummary = notices
    .map((n, i) => {
      const title = n.heading ?? "Uten tittel";
      const buyer = n.buyer?.[0]?.name ?? "Ukjent oppdragsgiver";
      const value = n.estimatedValue?.amount
        ? `${Number(n.estimatedValue.amount).toLocaleString("nb-NO")} ${n.estimatedValue.currencyCode ?? "NOK"}`
        : "Ikke oppgitt";
      // Prod-API returnerer full beskrivelse i søkeresultatet
      const description = (n.description ?? "").slice(0, 1000);
      // lots kan inneholde ytterligere detaljer
      const lotsText = (n.lots ?? [])
        .map((l) => l.description ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 500);
      const deadline = n.deadline
        ? `Frist: ${new Date(n.deadline).toLocaleDateString("nb-NO")}`
        : "";
      const link = n.doffinLink ?? "Ikke tilgjengelig";

      return [
        `--- Anskaffelse ${i + 1} ---`,
        `ID: ${n.id}`,
        `Tittel: ${title}`,
        `Oppdragsgiver: ${buyer}`,
        `Estimert verdi: ${value}`,
        deadline,
        `Lenke: ${link}`,
        description ? `Beskrivelse: ${description}` : "",
        lotsText ? `Delkontrakter: ${lotsText}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = `Her er anskaffelser publisert på Doffin ${yesterday}:\n\n${noticesSummary}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API returnerte ${res.status}: ${err}`);
  }

  const data = await res.json();
  const rawText = data.content?.[0]?.text ?? "";

  // Trekk ut RELEVANT_IDS fra starten av svaret
  const idsMatch = rawText.match(/^RELEVANT_IDS:\s*(.+)$/m);
  const relevantIds = idsMatch
    ? idsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Fjern RELEVANT_IDS-linjen fra teksten som vises
  const analysis = rawText.replace(/^RELEVANT_IDS:.*\n?/m, "").trim();

  // Debug: logg hva Claude faktisk svarte
  console.log(
    "[doffin-scout] Claude råsvar (første 1000 tegn):\n",
    analysis.slice(0, 1000),
  );

  return { analysis, relevantIds };
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
      to: [process.env.EMAIL_TO],
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

function formatEmailHtml(
  markdownAnalysis,
  totalCount,
  relevantCount,
  nonRelevantNotices,
  yesterday,
) {
  const date = formatNorwegianDate(new Date());
  const yesterdayFormatted = formatNorwegianDateFromString(yesterday);

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Doffin Scout</title>
  <style>
    /* Reset */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* Base */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      color: #1d1d1f;
      background: #f5f5f7;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px 16px;
    }

    /* Header */
    .header {
      background: #1d1d1f;
      border-radius: 16px 16px 0 0;
      padding: 28px 28px 24px;
    }
    .header-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #86868b;
      margin-bottom: 6px;
    }
    .header-title {
      font-size: 22px;
      font-weight: 700;
      color: #f5f5f7;
      letter-spacing: -0.3px;
    }
    .header-sub {
      font-size: 13px;
      color: #86868b;
      margin-top: 4px;
    }

    /* Stats */
    .stats {
      background: #fff;
      border-left: 1px solid #e5e5e5;
      border-right: 1px solid #e5e5e5;
      padding: 20px 28px;
      display: flex;
      gap: 0;
    }
    .stat {
      flex: 1;
      text-align: center;
      padding: 0 12px;
      border-right: 1px solid #e5e5e5;
    }
    .stat:last-child { border-right: none; }
    .stat-number {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -1px;
      color: #1d1d1f;
      line-height: 1;
    }
    .stat-number.green { color: #1d7a3c; }
    .stat-label {
      font-size: 11px;
      color: #86868b;
      margin-top: 4px;
      line-height: 1.3;
    }
    .arrow {
      display: flex;
      align-items: center;
      padding: 0 4px;
      color: #c7c7cc;
      font-size: 18px;
    }

    /* Body */
    .body {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-top: none;
      padding: 28px;
    }

    /* Relevant section */
    .section-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #86868b;
      margin-bottom: 16px;
    }

    .notice-card {
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .notice-title {
      font-size: 15px;
      font-weight: 600;
      color: #1d1d1f;
      margin-bottom: 2px;
    }
    .notice-buyer {
      font-size: 13px;
      color: #86868b;
      margin-bottom: 10px;
    }
    .notice-meta {
      font-size: 13px;
      color: #3a3a3c;
      margin-bottom: 8px;
    }
    .notice-relevance {
      font-size: 14px;
      color: #1d1d1f;
      line-height: 1.5;
      margin-bottom: 10px;
    }
    .notice-link {
      display: inline-block;
      font-size: 13px;
      font-weight: 500;
      color: #0071e3;
      text-decoration: none;
    }

    /* Summary */
    .summary {
      background: #f5f5f7;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 14px;
      color: #3a3a3c;
      margin-top: 20px;
      line-height: 1.6;
    }

    /* Divider */
    .divider {
      border: none;
      border-top: 1px solid #e5e5e5;
      margin: 24px 0;
    }

    /* Non-relevant list */
    .nonrelevant-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #86868b;
      margin-bottom: 12px;
    }
    .nonrelevant-item {
      padding: 10px 0;
      border-bottom: 1px solid #f2f2f2;
    }
    .nonrelevant-item:last-child { border-bottom: none; }
    .nonrelevant-link {
      font-size: 14px;
      font-weight: 500;
      color: #0071e3;
      text-decoration: none;
      display: block;
      margin-bottom: 2px;
    }
    .nonrelevant-buyer {
      font-size: 12px;
      color: #86868b;
    }

    /* Footer */
    .footer {
      border-radius: 0 0 16px 16px;
      background: #f5f5f7;
      border: 1px solid #e5e5e5;
      border-top: none;
      padding: 14px 28px;
      text-align: center;
      font-size: 12px;
      color: #86868b;
    }
    .footer a { color: #86868b; text-decoration: none; }

    /* Mobile */
    @media (max-width: 480px) {
      .wrapper { padding: 12px 8px; }
      .header { padding: 20px; border-radius: 12px 12px 0 0; }
      .header-title { font-size: 19px; }
      .body { padding: 20px; }
      .stat-number { font-size: 26px; }
      .stats { padding: 16px 20px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Header -->
    <div class="header">
      <div class="header-label">Doffin Scout · SoCentral</div>
      <div class="header-title">Nye anskaffelser</div>
      <div class="header-sub">${date} &nbsp;·&nbsp; Publisert ${yesterdayFormatted}</div>
    </div>

    <!-- Stats -->
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${totalCount}</div>
        <div class="stat-label">nye utlysninger<br>på Doffin</div>
      </div>
      <div class="arrow">→</div>
      <div class="stat">
        <div class="stat-number green">${relevantCount}</div>
        <div class="stat-label">relevante<br>for SoCentral</div>
      </div>
    </div>

    <!-- Body -->
    <div class="body">

      ${
        relevantCount > 0
          ? `
      <!-- Relevant notices -->
      <div class="section-label">Relevante muligheter</div>
      ${buildRelevantCardsHtml(markdownAnalysis)}
      `
          : `
      <p style="color:#86868b;font-size:14px">Ingen av dagens utlysninger ble vurdert som relevante for SoCentral.</p>
      `
      }

      <!-- Summary -->
      ${buildSummaryHtml(markdownAnalysis)}

      ${
        nonRelevantNotices && nonRelevantNotices.length > 0
          ? `
      <hr class="divider">
      <!-- Non-relevant -->
      <div class="nonrelevant-label">Øvrige utlysninger (${nonRelevantNotices.length})</div>
      ${nonRelevantNotices
        .map(
          (n) => `
        <div class="nonrelevant-item">
          <a href="${n.doffinLink ?? "#"}" class="nonrelevant-link">${n.heading ?? "Uten tittel"}</a>
          <div class="nonrelevant-buyer">${n.buyer?.[0]?.name ?? ""}</div>
        </div>
      `,
        )
        .join("")}
      `
          : ""
      }

    </div>

    <!-- Footer -->
    <div class="footer">
      Generert av Doffin Scout · SoCentral AS ·
      <a href="https://doffin.no">doffin.no</a>
    </div>

  </div>
</body>
</html>`;
}

// Trekker ut relevante utlysninger fra Claude-analysen og bygger kort
function buildRelevantCardsHtml(analysis) {
  if (!analysis) return "";

  // Del opp på **Tittel** – Oppdragsgiver mønster
  const cards = [];
  const lines = analysis.split("\n");
  let currentCard = null;

  for (const line of lines) {
    const titleMatch = line.match(/^\*\*(.+?)\*\*\s*[–-]\s*(.+)$/);
    if (titleMatch) {
      if (currentCard) cards.push(currentCard);
      currentCard = {
        title: titleMatch[1].trim(),
        buyer: titleMatch[2].trim(),
        meta: [],
        relevance: "",
        link: "",
      };
      continue;
    }
    if (!currentCard) continue;

    const metaMatch = line.match(
      /^[-*]\s*(Estimert verdi|Søknadsfrist|Frist):\s*(.+)$/,
    );
    if (metaMatch) {
      currentCard.meta.push(`${metaMatch[1]}: ${metaMatch[2]}`);
      continue;
    }

    const relevanceMatch = line.match(/^[-*]\s*Relevans:\s*(.+)$/);
    if (relevanceMatch) {
      currentCard.relevance = relevanceMatch[1];
      continue;
    }

    const linkMatch = line.match(/\[Se utlysning[^\]]*\]\((.+?)\)/);
    if (linkMatch) {
      currentCard.link = linkMatch[1];
      continue;
    }
  }
  if (currentCard) cards.push(currentCard);

  if (cards.length === 0) {
    // Fallback: vis ren tekst hvis parsing feiler
    return `<div style="font-size:14px;line-height:1.6;color:#1d1d1f">${analysis
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2" style="color:#0071e3">$1</a>',
      )
      .replace(/\n/g, "<br>")}</div>`;
  }

  return cards
    .map(
      (card) => `
    <div class="notice-card">
      <div class="notice-title">${card.title}</div>
      <div class="notice-buyer">${card.buyer}</div>
      ${card.meta.map((m) => `<div class="notice-meta">${m}</div>`).join("")}
      ${card.relevance ? `<div class="notice-relevance">${card.relevance}</div>` : ""}
      ${card.link ? `<a href="${card.link}" class="notice-link">Se utlysning på Doffin →</a>` : ""}
    </div>
  `,
    )
    .join("");
}

// Trekker ut oppsummeringsteksten fra Claude-analysen
function buildSummaryHtml(analysis) {
  if (!analysis) return "";
  const match = analysis.match(/## Oppsummering\s*([\s\S]+?)(?:## |$)/);
  if (!match) return "";
  const text = match[1].trim().replace(/\n/g, "<br>");
  return `<div class="summary">${text}</div>`;
}
