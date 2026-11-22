import type { ProtectedMedia } from '@/types/provenance';
import type { UrlAnalysisReport } from './provenance.native';

function unavailable(): never {
  throw new Error("La synchronisation et l'analyse de provenance sont disponibles dans l'application mobile.");
}

export async function syncProtectedMedia(_media: ProtectedMedia): Promise<void> {
  return unavailable();
}

export async function analyzePageUrl(_url: string): Promise<UrlAnalysisReport> {
  return unavailable();
}
