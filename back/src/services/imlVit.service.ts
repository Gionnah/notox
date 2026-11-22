import { env } from "../config/env.js";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_HEATMAP_DATA_URI_LENGTH = 8 * 1024 * 1024;
const PNG_DATA_URI_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export type ManipulationLocalization = {
  modelVersion: "iml-vit-1024";
  imageWidth: number;
  imageHeight: number;
  heatmapDataUri: string;
};

export class IMLVitServiceError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 503 = 503,
  ) {
    super(message);
    this.name = "IMLVitServiceError";
  }
}

function isLocalizationResult(value: unknown): value is ManipulationLocalization {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    result.modelVersion === "iml-vit-1024" &&
    typeof result.imageWidth === "number" &&
    Number.isInteger(result.imageWidth) &&
    result.imageWidth >= 1 &&
    result.imageWidth <= 1024 &&
    typeof result.imageHeight === "number" &&
    Number.isInteger(result.imageHeight) &&
    result.imageHeight >= 1 &&
    result.imageHeight <= 1024 &&
    typeof result.heatmapDataUri === "string" &&
    result.heatmapDataUri.length <= MAX_HEATMAP_DATA_URI_LENGTH &&
    PNG_DATA_URI_PATTERN.test(result.heatmapDataUri)
  );
}

export async function localizeImageWithIMLVit(
  image: Buffer,
  mimeType: string,
): Promise<ManipulationLocalization> {
  const headers: Record<string, string> = { "Content-Type": mimeType };
  if (env.IML_VIT_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${env.IML_VIT_SERVICE_TOKEN}`;
  }

  let response: Response;
  try {
    response = await fetch(`${env.IML_VIT_SERVICE_URL.replace(/\/+$/, "")}/v1/localize`, {
      method: "POST",
      headers,
      body: Uint8Array.from(image).buffer,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new IMLVitServiceError("Le service local IML-ViT est injoignable ou a dépassé le délai.");
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 415 || response.status === 413) {
      throw new IMLVitServiceError(
        "Cette image ne peut pas être traitée par le service IML-ViT.",
        422,
      );
    }
    throw new IMLVitServiceError("Le service local IML-ViT est temporairement indisponible.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!isLocalizationResult(data)) {
    throw new IMLVitServiceError("Le service IML-ViT a renvoyé un résultat invalide.");
  }
  return data;
}
