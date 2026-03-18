/**
 * debug-notices.mjs
 * Henter alle utlysninger fra i går + full detalj via download-endepunktet.
 * Outputter alt til console. Sender ikke til Claude eller epost.
 *
 * Kjør: node scripts/debug-notices.mjs
 * Krever: .env-fil med DOFFIN_API_KEY
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Last .env manuelt (unngår avhengighet av dotenv-pakke)
try {
  const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of env.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {
  console.error("Fant ikke .env-fil – sørg for at den finnes i prosjektmappen");
  process.exit(1);
}

const API_KEY = process.env.DOFFIN_API_KEY;
if (!API_KEY) {
  console.error("DOFFIN_API_KEY mangler i .env");
  process.exit(1);
}

const SEARCH_URL = "https://api.doffin.no/public/v2/search";
const DOWNLOAD_URL = "https://api.doffin.no/public/v2/download";

// ─── Datoberegning ────────────────────────────────────────────────────────────

function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  // Bruk norsk tidssone
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
}

// Prod-API bruker norsk dato direkte — ingen offset
const norwegianDate = process.argv[2] ?? getYesterday();
const apiDate = norwegianDate; // Samme dato, ingen manipulering
console.log(`\n${"=".repeat(60)}`);
console.log(
  `Doffin Debug – norsk dato: ${norwegianDate} (API-dato: ${apiDate})`,
);
console.log("=".repeat(60));

// ─── Søk ──────────────────────────────────────────────────────────────────────

async function search() {
  console.log(
    `\n⏳ Henter utlysninger (issueDateFrom=${apiDate}, tilsvarer norsk dato ${norwegianDate})...`,
  );

  const params = new URLSearchParams({
    numHitsPerPage: "100",
    page: "1",
    status: "ACTIVE",
    issueDateFrom: apiDate,
    issueDateTo: apiDate,
    sortBy: "PUBLICATION_DATE_DESC",
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": API_KEY },
  });
  if (!res.ok) throw new Error(`Søk feilet: ${res.status} ${res.statusText}`);
  const data = await res.json();

  console.log(`✅ Totalt ${data.numHitsTotal ?? 0} utlysninger`);
  return data;
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(id) {
  const res = await fetch(`${DOWNLOAD_URL}/${id}`, {
    headers: { "Ocp-Apim-Subscription-Key": API_KEY },
  });

  if (!res.ok) return { _error: `${res.status} ${res.statusText}` };

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text.slice(0, 2000) };
    }
  }

  // XML – returner råtekst for å inspisere strukturen
  return { _xml: text };
}

// ─── Hovedlogikk ──────────────────────────────────────────────────────────────

async function main() {
  // 1. Søk
  console.log("\n⏳ Henter søkeresultater...");
  const searchData = await search();
  const hits = searchData.hits ?? [];
  const total = searchData.numHitsTotal ?? hits.length;

  console.log(`✅ Fant ${total} utlysninger (${hits.length} returnert)\n`);

  if (hits.length === 0) {
    console.log("Ingen utlysninger å vise.");
    return;
  }

  // 2. Download + print per utlysning
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const prefix = `[${i + 1}/${hits.length}]`;

    console.log(`\n${"─".repeat(60)}`);
    console.log(`${prefix} ID: ${hit.id ?? "ukjent"}`);
    console.log(`${"─".repeat(60)}`);

    console.log(`TITTEL:         ${hit.heading ?? "—"}`);
    console.log(
      `OPPDRAGSGIVER:  ${hit.buyer?.map((b) => b.name).join(", ") ?? "—"}`,
    );
    console.log(`TYPE:           ${hit.type ?? "—"}`);
    console.log(
      `PUBLISERT:      ${hit.publicationDate ?? hit.issueDate ?? "—"}`,
    );
    console.log(`FRIST:          ${hit.deadline ?? "ikke angitt"}`);
    console.log(
      `ESTIMERT VERDI: ${
        hit.estimatedValue?.amount
          ? `${Number(hit.estimatedValue.amount).toLocaleString("nb-NO")} ${hit.estimatedValue.currencyCode ?? "NOK"}`
          : "ikke angitt"
      }`,
    );
    console.log(`CPV-KODER:      ${hit.cpvCodes?.join(", ") ?? "—"}`);
    console.log(`LOKASJONER:     ${hit.locationId?.join(", ") ?? "—"}`);
    console.log(`BESKRIVELSE:    ${hit.description ?? "INGEN"}`);

    if (hit.lots?.length > 0) {
      console.log(`LOTS (${hit.lots.length}):`);
      hit.lots.forEach((lot, j) => {
        console.log(`  [Lot ${j + 1}] ${lot.heading ?? "—"}`);
        console.log(`          ${lot.description ?? "ingen beskrivelse"}`);
      });
    }

    console.log(`LENKE:          https://doffin.no/notices/${hit.id}`);

    // Hent fullstendig innhold via download
    process.stdout.write(`  ⏳ Henter fullstendig innhold...`);
    const detail = await download(hit.id);
    process.stdout.write(` ferdig\n`);

    if (detail._error) {
      console.log(`  ⚠️  Download feilet: ${detail._error}`);
    } else if (detail._xml) {
      // Trekk ut all tekst mellom XML-tagger som inneholder beskrivelse
      const textMatches = [
        ...detail._xml.matchAll(
          /<cbc:Description[^>]*>([\s\S]*?)<\/cbc:Description>/g,
        ),
        ...detail._xml.matchAll(/<cbc:Name[^>]*>([\s\S]*?)<\/cbc:Name>/g),
        ...detail._xml.matchAll(/<cbc:Note[^>]*>([\s\S]*?)<\/cbc:Note>/g),
      ]
        .map((m) => m[1].trim())
        .filter((t) => t.length > 20);

      if (textMatches.length > 0) {
        console.log(`  FULL TEKST FRA XML:`);
        textMatches.forEach((t, i) => console.log(`    [${i + 1}] ${t}`));
      } else {
        // Ingen kjente tagger funnet – vis rå XML (første 2000 tegn)
        console.log(`  RAW XML (første 2000 tegn):`);
        console.log(
          detail._xml
            .slice(0, 2000)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Ferdig – ${hits.length} utlysninger vist`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ Feil:", err.message);
  process.exit(1);
});
