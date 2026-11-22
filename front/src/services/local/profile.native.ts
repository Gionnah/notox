import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DigitalProfile } from '@/types/provenance';

const PROFILE_STORAGE_KEY = 'digital-profile-v1';

export const DEFAULT_DIGITAL_PROFILE: DigitalProfile = {
  displayName: '',
  bio: '',
  isPublic: false,
  showMedia: false,
};

export function isDigitalProfile(value: unknown): value is DigitalProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.displayName === 'string' &&
    profile.displayName.length <= 50 &&
    typeof profile.bio === 'string' &&
    profile.bio.length <= 160 &&
    typeof profile.isPublic === 'boolean' &&
    typeof profile.showMedia === 'boolean' &&
    (profile.isPublic || !profile.showMedia)
  );
}

export async function loadDigitalProfile(): Promise<DigitalProfile> {
  const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
  if (raw === null) return DEFAULT_DIGITAL_PROFILE;

  const value: unknown = JSON.parse(raw);
  if (!isDigitalProfile(value)) {
    throw new Error("Les paramètres du profil numérique sont invalides.");
  }
  return value;
}

export async function saveDigitalProfile(profile: DigitalProfile): Promise<void> {
  if (!isDigitalProfile(profile)) {
    throw new Error("Les paramètres du profil numérique sont invalides.");
  }
  await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}
