/**
 * Netlify Scheduled Function: doffin-scout
 * Kjører daglig kl. 07:00 UTC (09:00 Oslo-tid)
 * Henter aktive Doffin-anskaffelser → analyserer med Claude → sender epost
 *
 * Krever miljøvariabler:
 *   DOFFIN_API_KEY      – Doffin Beta API subscription key
 *   ANTHROPIC_API_KEY   – Anthropic API key
 *   RESEND_API_KEY      – Resend.com API key (gratis inntil 3000 epost/mnd)
 *   EMAIL_FROM          – Avsenderadresse (må være verifisert i Resend)
 *   EMAIL_TO            – Mottaker (thomas.evensen@socentral.no)
 */

export const config = {
  schedule: "0 7 * * *", // 07:00 UTC = 09:00 Oslo-tid
};

// ─── Config ───────────────────────────────────────────────────────────────────

const DOFFIN_API_URL = "https://betaapi.doffin.no/public/v2/search";

const DOFFIN_PARAMS = {
  numHitsPerPage: 20,
  page: 1,
  estimatedValueFrom: 100_000,
  estimatedValueTo: 50_000_000,
  status: "ACTIVE", // Bruk EXPIRED for historiske data
};

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
1. Oppdrag innen fasilitering, medvirkning, innbyggerdialog, folkepaneler
2. Samfunnsutvikling, stedsutvikling, nabolagsprogrammer
3. Kurs, kompetanseutvikling, læringsnettverk
4. Tverrsektorielt samarbeid, partnerskap, prosessdesign
5. Klima, bærekraft, sirkulærøkonomi-relaterte oppdrag
6. Demokrati, inkludering, integrering

Svar i følgende format:

## Relevante muligheter

For HVER relevant anskaffelse:
**[Tittel]** – [Oppdragsgiver]
- Estimert verdi: [beløp eller "ikke oppgitt"]
- Søknadsfrist: [dato eller "ikke oppgitt"]
- Relevans: [1-2 setninger om hvorfor dette passer SoCentral]
- Doffin-lenke: [lenke hvis tilgjengelig]

## Oppsummering
[2-3 setninger om dagens batch totalt]

Hopp over åpenbart irrelevante anskaffelser (bygg/anlegg, IKT-infrastruktur, renholdstjenester osv.).
Svar på norsk.
`.trim();

// ─── Hovedfunksjon ────────────────────────────────────────────────────────────

export default async function handler() {
  console.log("[doffin-scout] Starter daglig kjøring...");

  try {
    const notices = await fetchDoffinNotices();
    console.log(`[doffin-scout] Hentet ${notices.length} anskaffelser fra Doffin`);

    if (notices.length === 0) {
      await sendEmail(
        "Doffin Scout – ingen anskaffelser i dag",
        "<p>Ingen anskaffelser matchet søkekriteriene i dag.</p>"
      );
      return;
    }

    const analysis = await analyzeWithClaude(notices);
    console.log("[doffin-scout] Claude-analyse ferdig");

    const html = formatEmailHtml(analysis, notices.length);
    const subject = `Doffin Scout – ${new Date().toLocaleDateString("nb-NO", {
      weekday: "long", day: "numeric", month: "long",
    })}`;

    await sendEmail(subject, html);
    console.log("[doffin-scout] Epost sendt");

  } catch (err) {
    console.error("[doffin-scout] Feil:", err.message);
    await sendEmail(
      "Doffin Scout – feil ved kjøring",
      `<p>Det oppstod en feil under daglig kjøring:</p><pre>${err.message}</pre>`
    ).catch(() => {});
  }
}

// ─── Doffin API ───────────────────────────────────────────────────────────────

async function fetchDoffinNotices() {
  const url = new URL(DOFFIN_API_URL);
  Object.entries(DOFFIN_PARAMS).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );

  const res = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.DOFFIN_API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Doffin API returnerte ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  return data.hits ?? data.notices ?? data.results ?? [];
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function analyzeWithClaude(notices) {
  const noticesSummary = notices
    .map((n, i) => {
      const title = n.title ?? n.name ?? "Uten tittel";
      const buyer =
        n.contracting_authority?.name ?? n.buyer?.name ?? "Ukjent oppdragsgiver";
      const value = n.estimated_value
        ? `${Number(n.estimated_value).toLocaleString("nb-NO")} NOK`
        : "Ikke oppgitt";
      const deadline = n.deadline ?? n.submission_deadline ?? "Ikke oppgitt";
      const description = (n.description ?? n.short_description ?? "").slice(0, 500);
      const link = n.url ?? n.doffin_url ?? "";

      return [
        `--- Anskaffelse ${i + 1} ---`,
        `Tittel: ${title}`,
        `Oppdragsgiver: ${buyer}`,
        `Estimert verdi: ${value}`,
        `Frist: ${deadline}`,
        link ? `URL: ${link}` : "",
        description ? `Beskrivelse: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = `Her er dagens anskaffelser fra Doffin (${new Date().toLocaleDateString("nb-NO")}):\n\n${noticesSummary}`;

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
  return data.content?.[0]?.text ?? "Ingen analyse returnert.";
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
      from: process.env.EMAIL_FROM,  // f.eks. "Doffin Scout <scout@socentral.no>"
      to: [process.env.EMAIL_TO],    // thomas.evensen@socentral.no
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

function formatEmailHtml(markdownAnalysis, noticeCount) {
  const date = new Date().toLocaleDateString("nb-NO", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Enkel markdown → HTML for epostklienter
  const body = markdownAnalysis
    .replace(/^## (.+)$/gm, "<h2 style='color:#1a1a2e;margin-top:24px'>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li style='margin:4px 0'>$1</li>")
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, "<ul style='margin:8px 0;padding-left:20px'>$&</ul>")
    .replace(/\n\n/g, "</p><p style='margin:12px 0'>")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="no">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#222;background:#fff">
  <div style="background:#1a1a2e;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">🔍 Doffin Scout</h1>
    <p style="margin:6px 0 0;opacity:.8;font-size:14px">${date} &nbsp;·&nbsp; ${noticeCount} anskaffelser analysert (1M–1B NOK)</p>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none">
    <p style="margin:0 0 12px">${body}</p>
  </div>
  <p style="color:#aaa;font-size:12px;margin-top:16px;text-align:center">
    Generert automatisk av Doffin Scout · SoCentral AS ·
    <a href="https://doffin.no" style="color:#aaa">doffin.no</a>
  </p>
</body>
</html>`;
}
