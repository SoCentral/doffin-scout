/**
 * Kjør doffin-scout direkte uten Netlify-timeout.
 * node run.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of env.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {
  console.error("Fant ikke .env-fil");
  process.exit(1);
}

const { default: handler } = await import("./netlify/functions/doffin-scout.mjs");
await handler();
