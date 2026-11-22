import type { DigitalProfile, ProtectedMedia } from '@/types/provenance';
import type { ManipulationLocalization, UrlAnalysisReport } from './provenance.native';

function unavailable(): never {
  throw new Error("La synchronisation et l'analyse de provenance sont disponibles dans l'application mobile.");
}

export async function syncProtectedMedia(_media: ProtectedMedia): Promise<void> {
  return unavailable();
}

export async function localizeProtectedMedia(
  _media: ProtectedMedia
): Promise<ManipulationLocalization> {
  return unavailable();
}

export async function analyzePageUrl(_url: string): Promise<UrlAnalysisReport> {
  return unavailable();
}

export async function updateDigitalProfile(_profile: DigitalProfile): Promise<void> {
  return unavailable();
}

export async function getPublicProfileUrl(): Promise<string> {
  return unavailable();
}
