import type { DigitalProfile } from '@/types/provenance';

export const DEFAULT_DIGITAL_PROFILE: DigitalProfile = {
  displayName: '',
  bio: '',
  isPublic: false,
  showMedia: false,
};

function unavailable(): never {
  throw new Error("La gestion du profil numérique est disponible dans l'application mobile.");
}

export async function loadDigitalProfile(): Promise<DigitalProfile> {
  return unavailable();
}

export async function saveDigitalProfile(_profile: DigitalProfile): Promise<void> {
  return unavailable();
}
