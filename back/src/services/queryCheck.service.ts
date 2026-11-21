import type { QueryCheckInput } from "../routes/queryCheck.routes.ts";

export type SourceKind =
  | "none"
  | "raw_text"
  | "facebook_url"
  | "unsupported_url";

export interface CheckedQuery {
  question: string | null;
  source: {
    kind: SourceKind;
    rawValue: string | null;
    normalizedValue: string | null;
    hostname: string | null;
  };
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
    const url = new URL(rawSource);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        kind: "raw_text",
        rawValue: rawSource,
        normalizedValue: rawSource,
        hostname: null,
      };
    }

    const host = url.hostname.toLowerCase();
    const isFacebook =
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "fb.watch" ||
      host === "m.facebook.com";

    return {
      kind: isFacebook ? "facebook_url" : "unsupported_url",
      rawValue: rawSource,
      normalizedValue: url.toString(),
      hostname: host,
    };
  } catch {
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