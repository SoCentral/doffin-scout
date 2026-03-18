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
  ],
  "summary": "2-3 setninger. Hvis ingen relevante: beskriv hva slags utlysninger som dominerte i dag."
}

Hvis ingen anskaffelser er relevante, returner cards som en tom liste: [].
Hvis ingen anskaffelser er mulig relevante, returner maybeCards som en tom liste: [].
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
      const html = formatEmailHtml([], [], "", totalCount, [], yesterday);
      await sendEmail(subject, html);
      return;
    }

    const { cards, maybeCards, summary } = await analyzeWithClaude(
      notices,
      yesterday,
    );
    console.log(
      `[doffin-scout] Relevante for SoCentral: ${cards.length}, mulig relevante: ${maybeCards.length}`,
    );

    const categorizedIds = new Set([...cards, ...maybeCards].map((c) => c.id));
    const nonRelevant = notices.filter((n) => !categorizedIds.has(n.id));

    const html = formatEmailHtml(
      cards,
      maybeCards,
      summary,
      totalCount,
      nonRelevant,
      yesterday,
    );
    await sendEmail(subject, html);
    console.log("[doffin-scout] Epost sendt");
  } catch (err) {
    console.error("[doffin-scout] Feil:", err.message);
    await sendEmail(
      "Doffin Scout – feil ved kjøring",
      `<p style="font-family:Helvetica,Arial,sans-serif;color:#1d1d1f">Det oppstod en feil under daglig kjøring:</p><pre style="font-family:monospace;font-size:13px;color:#e00">${err.message}</pre>`,
    ).catch(() => {});
  }
}

// ─── Datoberegning ────────────────────────────────────────────────────────────

function getDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const osloDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);

  return { apiDate: osloDate, yesterday: osloDate };
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
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Doffin API ───────────────────────────────────────────────────────────────

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
      const description = (n.description ?? "").slice(0, 1000);
      const lotsText = (n.lots ?? [])
        .map((l) => l.description ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 500);
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
      max_tokens: 2500,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
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
    // Graceful fallback: ingen relevante kort, men vis summary hvis mulig
    return {
      cards: [],
      summary: "Kunne ikke tolke analyseresultatet fra Claude.",
    };
  }

  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const maybeCards = Array.isArray(parsed.maybeCards) ? parsed.maybeCards : [];
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";

  return { cards, maybeCards, summary };
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

function formatEmailHtml(
  cards,
  maybeCards,
  summary,
  totalCount,
  nonRelevantNotices,
  yesterday,
) {
  const yesterdayFormatted = formatNorwegianDateFromString(yesterday);
  const relevantCount = cards.length;
  const maybeCount = maybeCards.length;

  const renderCard = (card, borderColor) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin-bottom:14px;border:1px solid ${borderColor};border-radius:10px;overflow:hidden">
      <tr>
        <td style="padding:14px 16px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1c1c1e;line-height:1.3">${escHtml(card.title)}</p>
          <p style="margin:0 0 10px;font-size:12px;color:#8e8e93">${escHtml(card.buyer)}</p>
          ${card.value ? `<p style="margin:0 0 3px;font-size:12px;color:#3a3a3c">Estimert verdi: ${escHtml(card.value)}</p>` : ""}
          ${card.deadline ? `<p style="margin:0 0 10px;font-size:12px;color:#3a3a3c">Søknadsfrist: ${escHtml(card.deadline)}</p>` : ""}
          ${card.relevance ? `<p style="margin:10px 0;font-size:13px;line-height:1.5;color:#1c1c1e">${escHtml(card.relevance)}</p>` : ""}
          ${card.link ? `<a href="${card.link}" style="font-size:13px;font-weight:500;color:#0066cc;text-decoration:none">Se utlysning på Doffin →</a>` : ""}
        </td>
      </tr>
    </table>`;

  const cardsHtml = cards.map((c) => renderCard(c, "#e0e0e5")).join("");
  const maybeCardsHtml = maybeCards
    .map((c) => renderCard(c, "#f0e0c0"))
    .join("");

  const nonRelevantHtml =
    nonRelevantNotices.length > 0
      ? `
    <tr><td style="padding:20px 28px 0"><hr style="border:none;border-top:1px solid #e0e0e5;margin:0"></td></tr>
    <tr>
      <td style="padding:16px 28px 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
        <p style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8e8e93">
          Øvrige utlysninger (${nonRelevantNotices.length})
        </p>
        ${nonRelevantNotices
          .map(
            (n) => `
          <p style="margin:0 0 7px;font-size:13px;line-height:1.45;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
            <a href="${n.doffinLink ?? "#"}" style="color:#0066cc;text-decoration:none;font-weight:500">${escHtml(n.heading ?? "Uten tittel")}</a>
            <span style="color:#8e8e93"> — ${escHtml(n.buyer?.[0]?.name ?? "")}</span>
          </p>`,
          )
          .join("")}
      </td>
    </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="no" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="x-apple-disable-message-reformatting">
  <title>Doffin Scout</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f2f7;-webkit-font-smoothing:antialiased">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f2f7;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

          <!-- Subject line -->
          <tr>
            <td style="padding:0 4px 20px">
              <p style="margin:0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#1c1c1e;letter-spacing:-0.3px">
                Nye anskaffelser – ${yesterdayFormatted}
              </p>
            </td>
          </tr>

          <!-- Main body card -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e0e0e5">

            <!-- Lede -->
            <tr>
              <td style="padding:24px 28px 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
                <p style="margin:0;font-size:15px;line-height:1.55;color:#3a3a3c">
                  Doffin hadde <strong style="color:#1c1c1e">${totalCount} nye utlysninger</strong> i går.
                  ${
                    relevantCount > 0
                      ? `Claude identifiserte <strong style="color:#1c1c1e">${relevantCount} ${relevantCount === 1 ? "mulighet" : "muligheter"}</strong> som er relevante for SoCentral${maybeCount > 0 ? `, og <strong style="color:#1c1c1e">${maybeCount}</strong> som kan være verdt å se nærmere på` : ""}.`
                      : maybeCount > 0
                        ? `Ingen klare treff, men <strong style="color:#1c1c1e">${maybeCount}</strong> utlysninger kan være verdt å se nærmere på.`
                        : "Ingen av dem ble vurdert som relevante for SoCentral."
                  }
                </p>
              </td>
            </tr>

            ${
              relevantCount > 0
                ? `
            <tr><td style="padding:20px 28px 0"><hr style="border:none;border-top:1px solid #e0e0e5;margin:0"></td></tr>
            <tr>
              <td style="padding:20px 28px 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
                <p style="margin:0 0 16px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#8e8e93">
                  Relevante muligheter
                </p>
                ${cardsHtml}
              </td>
            </tr>`
                : ""
            }

            ${
              maybeCount > 0
                ? `
            <tr><td style="padding:20px 28px 0"><hr style="border:none;border-top:1px solid #e0e0e5;margin:0"></td></tr>
            <tr>
              <td style="padding:20px 28px 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
                <p style="margin:0 0 16px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#b8860b">
                  Kan være relevant (${maybeCount})
                </p>
                ${maybeCardsHtml}
              </td>
            </tr>`
                : ""
            }

            ${
              summary
                ? `
            <tr>
              <td style="padding:16px 28px 0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif">
                <p style="margin:0;padding:12px 14px;background:#f2f2f7;border-radius:8px;font-size:13px;line-height:1.6;color:#3a3a3c">${escHtml(summary)}</p>
              </td>
            </tr>`
                : ""
            }

            ${nonRelevantHtml}

            <!-- Footer -->
            <tr><td style="padding:24px 28px">
              <p style="margin:0;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:11px;color:#aeaeb2">
                Generert av Doffin Scout · SoCentral AS ·
                <a href="https://doffin.no" style="color:#aeaeb2;text-decoration:none">doffin.no</a>
              </p>
            </td></tr>

          </table>

        </table>
      </td>
    </tr>
  </table>

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
