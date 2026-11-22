import type { ProtectedMedia, ProvenanceCheck } from '@/types/provenance';

function unavailable(): never {
  throw new Error('La protection des images est disponible dans la version mobile de NOTOX.');
}

export async function loadProtectedMedia(): Promise<ProtectedMedia[]> {
  return unavailable();
}

export async function loadAutoProtection(): Promise<boolean> {
  return unavailable();
}

export async function saveAutoProtection(_enabled: boolean): Promise<void> {
  return unavailable();
}

export async function protectImage(_uri: string, _fileName: string): Promise<ProtectedMedia> {
  return unavailable();
}

export async function verifyProtectedMedia(_media: ProtectedMedia): Promise<ProvenanceCheck> {
  return unavailable();
}
