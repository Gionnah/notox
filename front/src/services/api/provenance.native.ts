import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import {
  getSigningPublicKey,
  markProtectedMediaSynced,
  signRequestMessage,
} from '@/services/local/provenance';
import type { DigitalProfile, ProtectedMedia } from '@/types/provenance';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const REQUEST_TIMEOUT_MS = 60_000;

export type UrlAnalysisReport = {
  id: string;
  sourceUrl: string;
  checkedAt: number;
  registeredContentCount: number;
  comparedImageCount: number;
  skippedImageCount: number;
  matches: {
    imageUrl: string;
    imageHash: string;
    candidates: { mediaId: string; similarity: number }[];
  }[];
  disclaimer: string;
};

export type ManipulationLocalization = {
  modelVersion: 'iml-vit-1024';
  imageWidth: number;
  imageHeight: number;
  heatmapDataUri: string;
  checkedAt: number;
  disclaimer: string;
};

function getApiUrl(): string {
  if (!API_URL) {
    throw new Error("EXPO_PUBLIC_API_URL n'est pas configurée.");
  }
  return API_URL.replace(/\/+$/, '');
}

function imageMimeType(file: File): string {
  switch (file.extension.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      throw new Error("Format non pris en charge pour l'analyse IA (JPEG, PNG ou WebP requis).");
  }
}

export async function syncProtectedMedia(media: ProtectedMedia): Promise<void> {
  const file = new File(media.uri);
  if (!file.exists) throw new Error("Le fichier protégé n'est plus accessible.");

  const record = {
    id: media.id,
    sha256: media.sha256,
    createdAt: media.createdAt,
    publicKey: media.publicKey,
    signature: media.signature,
  };
  const bytes = await file.bytes();
  const response = await fetch(`${getApiUrl()}/api/provenance/media`, {
    method: 'POST',
    headers: {
      'Content-Type': imageMimeType(file),
      'X-Notox-Record': encodeURIComponent(JSON.stringify(record)),
      Accept: 'application/json',
    },
    body: Uint8Array.from(bytes).buffer,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Erreur du serveur (${response.status}).`;
    throw new Error(message);
  }
  await markProtectedMediaSynced(media.id);
}

export async function localizeProtectedMedia(
  media: ProtectedMedia
): Promise<ManipulationLocalization> {
  const file = new File(media.uri);
  if (!file.exists) throw new Error("Le fichier protégé n'est plus accessible.");
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("Cette image dépasse la taille maximale de 25 Mo.");
  }

  const bytes = await file.bytes();
  const record = {
    id: media.id,
    sha256: media.sha256,
    createdAt: media.createdAt,
    publicKey: media.publicKey,
    signature: media.signature,
  };
  const response = await fetch(`${getApiUrl()}/api/provenance/localize-image`, {
    method: 'POST',
    headers: {
      'Content-Type': imageMimeType(file),
      'X-Notox-Record': encodeURIComponent(JSON.stringify(record)),
      Accept: 'application/json',
    },
    body: Uint8Array.from(bytes).buffer,
    signal: AbortSignal.timeout(120_000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Erreur du serveur (${response.status}).`;
    throw new Error(message);
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error("Le résultat de localisation reçu est invalide.");
  }
  const result = data as Record<string, unknown>;
  if (
    result.modelVersion !== 'iml-vit-1024' ||
    typeof result.imageWidth !== 'number' ||
    !Number.isInteger(result.imageWidth) ||
    result.imageWidth < 1 ||
    result.imageWidth > 1024 ||
    typeof result.imageHeight !== 'number' ||
    !Number.isInteger(result.imageHeight) ||
    result.imageHeight < 1 ||
    result.imageHeight > 1024 ||
    typeof result.heatmapDataUri !== 'string' ||
    result.heatmapDataUri.length > 8 * 1024 * 1024 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.heatmapDataUri) ||
    typeof result.checkedAt !== 'number' ||
    !Number.isFinite(result.checkedAt) ||
    typeof result.disclaimer !== 'string'
  ) {
    throw new Error("Le résultat de localisation reçu est invalide.");
  }

  return {
    modelVersion: 'iml-vit-1024',
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    heatmapDataUri: result.heatmapDataUri,
    checkedAt: result.checkedAt,
    disclaimer: result.disclaimer,
  };
}

export async function analyzePageUrl(url: string): Promise<UrlAnalysisReport> {
  const cleanUrl = url.trim();
  const timestamp = Date.now();
  const nonce = Crypto.randomUUID();
  const signedMessage = JSON.stringify({
    domain: 'notox-url-analysis-v1',
    url: encodeURIComponent(cleanUrl),
    timestamp,
    nonce,
  });
  const [publicKey, signature] = await Promise.all([
    getSigningPublicKey(),
    signRequestMessage(signedMessage),
  ]);
  const response = await fetch(`${getApiUrl()}/api/provenance/analyze-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url: cleanUrl, publicKey, timestamp, nonce, signature }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Erreur du serveur (${response.status}).`;
    throw new Error(message);
  }
  if (typeof data !== 'object' || data === null || !('report' in data)) {
    throw new Error('Le rapport reçu est invalide.');
  }
  const report: unknown = data.report;
  if (
    typeof report !== 'object' ||
    report === null ||
    !('id' in report) ||
    typeof report.id !== 'string' ||
    !('sourceUrl' in report) ||
    typeof report.sourceUrl !== 'string' ||
    !('checkedAt' in report) ||
    typeof report.checkedAt !== 'number' ||
    !('registeredContentCount' in report) ||
    typeof report.registeredContentCount !== 'number' ||
    !('comparedImageCount' in report) ||
    typeof report.comparedImageCount !== 'number' ||
    !('skippedImageCount' in report) ||
    typeof report.skippedImageCount !== 'number' ||
    !('disclaimer' in report) ||
    typeof report.disclaimer !== 'string' ||
    !('matches' in report) ||
    !Array.isArray(report.matches)
  ) {
    throw new Error('Le rapport reçu est invalide.');
  }

  const matches: UrlAnalysisReport['matches'] = report.matches.flatMap((match: unknown) => {
    if (typeof match !== 'object' || match === null) return [];
    if (
      !('imageUrl' in match) ||
      typeof match.imageUrl !== 'string' ||
      !('imageHash' in match) ||
      typeof match.imageHash !== 'string' ||
      !('candidates' in match) ||
      !Array.isArray(match.candidates)
    ) {
      return [];
    }
    const candidates = match.candidates.flatMap((candidate: unknown) => {
      if (typeof candidate !== 'object' || candidate === null) return [];
      if (
        !('mediaId' in candidate) ||
        typeof candidate.mediaId !== 'string' ||
        !('similarity' in candidate) ||
        typeof candidate.similarity !== 'number'
      ) {
        return [];
      }
      return [{ mediaId: candidate.mediaId, similarity: candidate.similarity }];
    });
    return [{ imageUrl: match.imageUrl, imageHash: match.imageHash, candidates }];
  });

  return {
    id: report.id,
    sourceUrl: report.sourceUrl,
    checkedAt: report.checkedAt,
    registeredContentCount: report.registeredContentCount,
    comparedImageCount: report.comparedImageCount,
    skippedImageCount: report.skippedImageCount,
    matches,
    disclaimer: report.disclaimer,
  };
}

export async function updateDigitalProfile(profile: DigitalProfile): Promise<void> {
  const timestamp = Date.now();
  const nonce = Crypto.randomUUID();
  const publicKey = await getSigningPublicKey();
  const publicFields = {
    displayName: profile.isPublic ? profile.displayName.trim() : '',
    bio: profile.isPublic ? profile.bio.trim() : '',
    isPublic: profile.isPublic,
    showMedia: profile.isPublic && profile.showMedia,
  };
  const signedMessage = JSON.stringify({
    domain: 'notox-profile-update-v1',
    publicKey,
    ...publicFields,
    timestamp,
    nonce,
  });
  const signature = await signRequestMessage(signedMessage);
  const response = await fetch(`${getApiUrl()}/api/provenance/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ publicKey, timestamp, nonce, ...publicFields, signature }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Erreur du serveur (${response.status}).`;
    throw new Error(message);
  }
}

export async function getPublicProfileUrl(): Promise<string> {
  return `${getApiUrl()}/api/provenance/p/${await getSigningPublicKey()}`;
}
