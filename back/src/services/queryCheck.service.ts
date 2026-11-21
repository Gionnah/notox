import type { QueryCheckInput } from "../routes/queryCheck.routes.ts";

export type SourceKind = "none" | "raw_text" | "facebook_url";

export type QueryCheckErrorCode = "UNSUPPORTED_PLATFORM";

export class UnsupportedPlatformError extends Error {
  public readonly code: QueryCheckErrorCode = "UNSUPPORTED_PLATFORM";
  public readonly hostname: string;

  constructor(hostname: string, message?: string) {
    super(
      message ??
        `Le domaine "${hostname}" n'est pas pris en charge : seules les URLs Facebook sont acceptées pour le moment.`
    );
    this.name = "UnsupportedPlatformError";
    this.hostname = hostname;
  }
}

export interface CheckedQuery {
  question: string | null;
  source: {
    kind: SourceKind;
    rawValue: string | null;
    normalizedValue: string | null;
    hostname: string | null;
  };
}

const FACEBOOK_HOST_REGEX =
  /^(?:(?:[\w-]+\.)*facebook\.com|fb\.watch)$/i;

export function isFacebookHostname(hostname: string): boolean {
  return FACEBOOK_HOST_REGEX.test(hostname.trim().toLowerCase());
}

export function detectSource(rawSource?: string): CheckedQuery["source"] {
  if (!rawSource) {
    return {
      kind: "none",
      rawValue: null,
      normalizedValue: null,
      hostname: null,
    };
  }

  try {
    const parsed = new URL(rawSource);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const host = parsed.hostname.toLowerCase();

      if (!isFacebookHostname(host)) {
        throw new UnsupportedPlatformError(host);
      }

      return {
        kind: "facebook_url",
        rawValue: rawSource,
        normalizedValue: parsed.toString(),
        hostname: host,
      };
    }

    // Autre schéma non HTTP(S) (ex. ftp:// ou texte contenant ":") -> traité comme texte brut
    return {
      kind: "raw_text",
      rawValue: rawSource,
      normalizedValue: rawSource,
      hostname: null,
    };
  } catch (err) {
    if (err instanceof UnsupportedPlatformError) {
      throw err;
    }

    // Pas une URL valide -> texte brut
    return {
      kind: "raw_text",
      rawValue: rawSource,
      normalizedValue: rawSource,
      hostname: null,
    };
  }
}

export function runQueryCheck(input: QueryCheckInput): CheckedQuery {
  const cleanQuestion = input.question?.trim() || null;
  const cleanSource = input.source?.trim() || undefined;

  return {
    question: cleanQuestion,
    source: detectSource(cleanSource),
  };
}