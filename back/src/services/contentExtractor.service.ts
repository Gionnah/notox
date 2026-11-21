import * as cheerio from "cheerio";
import type { SourceKind } from "./queryCheck.service.js";
import { fetchFacebookPostViaApify } from "./facebookApifyFallback.service.js";

export interface ExtractedContent {
  kind: SourceKind;
  title: string | null;
  text: string;
  warning: string | null;
  provider?: "direct" | "apify" | "raw";
}

const MAX_TEXT_LENGTH = 12000;
const MIN_FACEBOOK_TEXT_LENGTH = 80;

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/(\.\.\.\s*)+$/g, "")
    .trim();
}

function truncateText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

async function fetchFacebookHtml(url: string, timeoutMs = 6000): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FactCheckBot/1.0; +https://example.local)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  return await response.text();
}

export async function extractSourceContent(params: {
  kind: SourceKind;
  rawValue: string | null;
  normalizedValue: string | null;
}): Promise<ExtractedContent> {
  const { kind, rawValue, normalizedValue } = params;

  if (kind === "none") {
    return {
      kind,
      title: null,
      text: "",
      warning: null,
    };
  }

  if (kind === "raw_text") {
    return {
      kind,
      title: null,
      text: truncateText(cleanText(rawValue ?? "")),
      warning: null,
      provider: "raw",
    };
  }

  if (!normalizedValue) {
    return {
      kind,
      title: null,
      text: "",
      warning: "URL Facebook manquante ou invalide.",
    };
  }

  // kind === "facebook_url" : 1) extraction légère via Cheerio
  let directTitle: string | null = null;
  let directText = "";

  try {
    const html = await fetchFacebookHtml(normalizedValue, 6000);
    const $ = cheerio.load(html);

    const parts = [
      $('meta[property="og:title"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $('meta[name="twitter:description"]').attr("content"),
      $('meta[name="description"]').attr("content"),
    ]
      .map((v) => cleanText(v ?? ""))
      .filter((v, idx, arr) => v.length > 0 && arr.indexOf(v) === idx);

    directTitle = parts[0] ?? null;
    directText = truncateText(parts.join(" — "));
  } catch {
    // On passe au fallback Apify ci-dessous
  }

  if (directText.length >= MIN_FACEBOOK_TEXT_LENGTH) {
    return {
      kind,
      title: directTitle,
      text: directText,
      warning:
        "Aperçu partiel récupéré depuis Facebook : le contexte complet peut être partiel.",
      provider: "direct",
    };
  }

  // 2) Fallback Apify si la description directe est absente ou incomplète
  try {
    const apifyResult = await fetchFacebookPostViaApify(normalizedValue);
    if (apifyResult && apifyResult.text.length > 0) {
      return {
        kind,
        title: apifyResult.title ?? directTitle,
        text: truncateText(cleanText(apifyResult.text)),
        warning: null,
        provider: "apify",
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "APIFY_FALLBACK_ERROR";
    return {
      kind,
      title: directTitle,
      text: directText,
      warning: `Fallback Apify indisponible (${reason}). Collez directement le texte du post si besoin.`,
      provider: "direct",
    };
  }

  return {
    kind,
    title: directTitle,
    text: directText,
    warning:
      "Description Facebook incomplète ou inaccessible. Collez directement le texte de la publication pour l'analyser.",
    provider: "direct",
  };
}