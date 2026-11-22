import type { LibraryScanResult } from './mediaLibraryScanner.native';

function unavailable(): never {
  throw new Error('Le scan automatique de la photothèque est disponible dans l’application mobile.');
}

export async function isNewImageMonitoringEnabled(): Promise<boolean> {
  return unavailable();
}

export async function enableNewImageMonitoring(): Promise<number> {
  return unavailable();
}

export async function disableNewImageMonitoring(): Promise<void> {
  return unavailable();
}

export function observeImageLibraryChanges(_listener: () => void): { remove: () => void } {
  return { remove: () => undefined };
}

export async function scanNewImages(): Promise<LibraryScanResult> {
  return unavailable();
}
