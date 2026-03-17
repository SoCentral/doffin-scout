/**
 * Netlify Scheduled Function: doffin-scout
 * Kjører daglig kl. 07:00 UTC (09:00 Oslo-tid)
 * Henter alle nye anskaffelser fra i går, analyserer relevante for SoCentral.
 */

export const config = {
  schedule: "0 7 * * *",
};

const DOFFIN_API_URL = "https://betaapi.doffin.no/public/v2/search";
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

RELEVANT_COUNT: [tall]

## Relevante muligheter

For HVER relevant anskaffelse:
**[Tittel]** – [Oppdragsgiver]
- Estimert verdi: [beløp eller "ikke oppgitt"]
- Relevans: [1-2 setninger om hvorfor dette passer SoCentral]
- 🔗 [Se utlysning på Doffin]([lenke])

## Oppsummering
[2-3 setninger. Hvis ingen relevante: si det tydelig.]

Hopp over åpenbart irrelevante anskaffelser (bygg/anlegg, IKT-infrastruktur, renholdstjenester, varekjøp osv.).
Svar på norsk.
`.trim();

// ─── Hovedfunksjon ────────────────────────────────────────────────────────────

export default async function handler() {
  console.log("[doffin-scout] Starter daglig kjøring...");

  try {
    const { yesterday, today } = getDateRange();
    console.log(`[doffin-scout] Henter anskaffelser publisert ${yesterday}`);

    // Hent 1: totalt antall nye utlysninger i går (alle verdier)
    const totalCount = await fetchTotalCount(yesterday, today);
    console.log(`[doffin-scout] Totalt nye utlysninger i går: ${totalCount}`);

    // Hent 2: utlysninger i verdiintervallet 1M–1B for analyse
    const notices = await fetchDoffinNotices(yesterday, today);
    console.log(`[doffin-scout] Anskaffelser i 1M–1B NOK: ${notices.length}`);

    const subject = `Doffin Scout – ${formatNorwegianDate(new Date())}`;

    if (notices.length === 0) {
      const html = formatEmailHtml(null, totalCount, 0, 0, yesterday);
      await sendEmail(subject, html);
      return;
    }

    const { analysis, relevantCount } = await analyzeWithClaude(
      notices,
      yesterday,
    );
    console.log(`[doffin-scout] Relevante for SoCentral: ${relevantCount}`);

    const html = formatEmailHtml(
      analysis,
      totalCount,
      notices.length,
      relevantCount,
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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    yesterday: yesterday.toISOString().split("T")[0],
    today: today.toISOString().split("T")[0],
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

// Henter totalt antall nye utlysninger i går (alle verdier, numHitsPerPage=1 for effektivitet)
async function fetchTotalCount(issueDateFrom, issueDateTo) {
  const params = new URLSearchParams({
    numHitsPerPage: "1",
    page: "1",
    status: "ACTIVE",
    issueDateFrom, // Korrekt parameternavn iflg. API-dok
    issueDateTo,
  });

  const res = await fetch(`${DOFFIN_API_URL}?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": process.env.DOFFIN_API_KEY },
  });

  if (!res.ok) throw new Error(`Doffin API (total) returnerte ${res.status}`);

  const data = await res.json();
  console.log("[doffin-scout] numHitsTotal:", data.numHitsTotal);

  // Korrekt feltnavn iflg. API-dok: numHitsTotal
  return data.numHitsTotal ?? 0;
}

// Henter anskaffelser i verdiintervallet 100k–50M for analyse
async function fetchDoffinNotices(issueDateFrom, issueDateTo) {
  const params = new URLSearchParams({
    numHitsPerPage: "50",
    page: "1",
    estimatedValueFrom: "100000",
    estimatedValueTo: "50000000",
    status: "ACTIVE",
    issueDateFrom, // Korrekt parameternavn iflg. API-dok
    issueDateTo,
    sortBy: "PUBLICATION_DATE_DESC",
  });

  const res = await fetch(`${DOFFIN_API_URL}?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": process.env.DOFFIN_API_KEY },
  });

  if (!res.ok)
    throw new Error(`Doffin API returnerte ${res.status}: ${res.statusText}`);

  const data = await res.json();
  const hits = data.hits ?? data.notices ?? data.results ?? [];

  return hits.map((n) => ({
    ...n,
    doffinLink: buildDoffinLink(n),
  }));
}

function buildDoffinLink(notice) {
  // Iflg. API-dok er feltet bare kalt "id"
  const id = notice.id ?? null;
  if (!id) return null;
  return `${DOFFIN_BASE_URL}/${id}`;
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function analyzeWithClaude(notices, yesterday) {
  const noticesSummary = notices
    .map((n, i) => {
      // Korrekte feltnavn iflg. API-dok: heading, buyer[].name, estimatedValue.amount
      const title = n.heading ?? "Uten tittel";
      const buyer = n.buyer?.[0]?.name ?? "Ukjent oppdragsgiver";
      const value = n.estimatedValue?.amount
        ? `${Number(n.estimatedValue.amount).toLocaleString("nb-NO")} ${n.estimatedValue.currencyCode ?? "NOK"}`
        : "Ikke oppgitt";
      const description = (n.description ?? "").slice(0, 500);
      // Ingen frist i søkeresultatet iflg. API-dok – kun id, heading, buyer, estimatedValue, description
      const link = n.doffinLink ?? "Ikke tilgjengelig";

      return [
        `--- Anskaffelse ${i + 1} ---`,
        `Tittel: ${title}`,
        `Oppdragsgiver: ${buyer}`,
        `Estimert verdi: ${value}`,
        `Lenke: ${link}`,
        description ? `Beskrivelse: ${description}` : "",
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

  // Trekk ut RELEVANT_COUNT fra starten av svaret
  const countMatch = rawText.match(/^RELEVANT_COUNT:\s*(\d+)/m);
  const relevantCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Fjern RELEVANT_COUNT-linjen fra teksten som vises
  const analysis = rawText.replace(/^RELEVANT_COUNT:.*\n?/m, "").trim();

  return { analysis, relevantCount };
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
  analyzedCount,
  relevantCount,
  yesterday,
) {
  const date = formatNorwegianDate(new Date());
  const yesterdayFormatted = formatNorwegianDateFromString(yesterday);

  // Statistikkbanner
  const statsHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr>
        <td style="text-align:center;padding:14px 8px;background:#fff;border:1px solid #e0e0e0;border-radius:6px">
          <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${totalCount}</div>
          <div style="font-size:12px;color:#666;margin-top:2px">nye utlysninger<br>på Doffin i går</div>
        </td>
        <td style="width:20px;text-align:center;color:#ccc;font-size:20px">→</td>
        <td style="text-align:center;padding:14px 8px;background:#fff;border:1px solid #e0e0e0;border-radius:6px">
          <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${analyzedCount}</div>
          <div style="font-size:12px;color:#666;margin-top:2px">analysert<br>(verdi 100k–50M NOK)</div>
        </td>
        <td style="width:20px;text-align:center;color:#ccc;font-size:20px">→</td>
        <td style="text-align:center;padding:14px 8px;background:#eef7ee;border:1px solid #b2d8b2;border-radius:6px">
          <div style="font-size:28px;font-weight:bold;color:#2a7a2a">${relevantCount}</div>
          <div style="font-size:12px;color:#4a8a4a;margin-top:2px">relevante<br>for SoCentral</div>
        </td>
      </tr>
    </table>`;

  let bodyHtml = "";
  if (!markdownAnalysis || analyzedCount === 0) {
    bodyHtml = `<p style="color:#666">Ingen anskaffelser i verdiintervallet 100k–50M NOK ble publisert på Doffin ${yesterdayFormatted}.</p>`;
  } else {
    bodyHtml = markdownAnalysis
      .replace(
        /^## (.+)$/gm,
        "<h2 style='color:#1a1a2e;margin-top:24px;margin-bottom:8px'>$1</h2>",
      )
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /🔗 \[(.+?)\]\((.+?)\)/g,
        '🔗 <a href="$2" style="color:#0066cc;text-decoration:none">$1</a>',
      )
      .replace(
        /\[(.+?)\]\((.+?)\)/g,
        '<a href="$2" style="color:#0066cc;text-decoration:none">$1</a>',
      )
      .replace(/^- (.+)$/gm, "<li style='margin:4px 0'>$1</li>")
      .replace(
        /(<li[^>]*>.*<\/li>\n?)+/g,
        "<ul style='margin:8px 0;padding-left:20px'>$&</ul>",
      )
      .replace(/\n\n/g, "</p><p style='margin:12px 0'>")
      .replace(/\n/g, "<br>");
  }

  return `<!DOCTYPE html>
<html lang="no">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#222;background:#fff">
  <div style="background:#1a1a2e;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">🔍 Doffin Scout</h1>
    <p style="margin:6px 0 0;opacity:.8;font-size:14px">${date} &nbsp;·&nbsp; Utlysninger publisert ${yesterdayFormatted}</p>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none">
    ${statsHtml}
    <p style="margin:0 0 12px">${bodyHtml}</p>
  </div>
  <p style="color:#aaa;font-size:12px;margin-top:16px;text-align:center">
    Generert automatisk av Doffin Scout · SoCentral AS ·
    <a href="https://doffin.no" style="color:#aaa">doffin.no</a>
  </p>
</body>
</html>`;
}
