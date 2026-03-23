/**
 * debug.mjs
 * Henter utlysninger med produksjonsparametere (NO08 + anyw, 200 per dag)
 * og lister antall og titler.
 *
 * Kjør: node debug.mjs
 * Kjør: node debug.mjs 2026-03-16 2026-03-22   (egendefinert periode)
 * Krever: .env-fil med DOFFIN_API_KEY
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Last .env manuelt
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

// ─── Datoberegning ────────────────────────────────────────────────────────────

function getLastWeekDates() {
  const today = new Date();
  const fmt = (d) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const sun = new Date(today);
  sun.setDate(today.getDate() - 1);

  const mon = new Date(sun);
  mon.setDate(sun.getDate() - 6);

  return { from: fmt(mon), to: fmt(sun) };
}

const fromDate = process.argv[2] ?? getLastWeekDates().from;
const toDate = process.argv[3] ?? getLastWeekDates().to;

// ─── Søkefunksjon ─────────────────────────────────────────────────────────────

async function search() {
  const params = new URLSearchParams({
    numHitsPerPage: "200",
    page: "1",
    status: "ACTIVE",
    issueDateFrom: fromDate,
    issueDateTo: toDate,
    sortBy: "PUBLICATION_DATE_DESC",
  });
  params.append("location", "NO08");
  params.append("location", "anyw");

  const url = `${SEARCH_URL}?${params}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": API_KEY },
  });

  const bodyText = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  return { data: JSON.parse(bodyText), url };
}

// ─── Hovedlogikk ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Doffin Scout – ${fromDate} → ${toDate}`);
  console.log(`Lokasjon: NO08 + anyw | Status: ACTIVE | numHitsPerPage: 200`);
  console.log("=".repeat(70));

  const { data, url } = await search();
  const total = data.numHitsTotal ?? 0;
  const hits = data.hits ?? [];

  console.log(`\nURL: ${url}`);
  console.log(`\nnumHitsTotal: ${total}   returnert: ${hits.length}\n`);

  if (hits.length === 0) {
    console.log("Ingen utlysninger funnet.");
    return;
  }

  console.log("─".repeat(70));
  hits.forEach((h, i) => {
    const buyer = h.buyer?.[0]?.name ?? "Ukjent";
    const date = h.issueDate ?? h.publicationDate ?? "—";
    console.log(`${String(i + 1).padStart(3)}. [${date}] ${h.heading ?? "Uten tittel"}`);
    console.log(`      ${buyer} · https://doffin.no/notices/${h.id}`);
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Totalt: ${hits.length} utlysninger vist (${total} totalt)`);
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\nFeil:", err.message);
  process.exit(1);
});
