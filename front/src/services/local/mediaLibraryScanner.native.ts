import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';

import { syncProtectedMedia } from '@/services/api/provenance';
import { hasProtectedAsset, markProtectedMediaSynced, protectImage } from './provenance';
import type { ProtectedMedia } from '@/types/provenance';

const MONITORING_KEY = 'new-image-monitoring-v1';
const KNOWN_ASSETS_KEY = 'known-photo-library-assets-v1';
const ASSET_PAGE_SIZE = 200;

export type LibraryScanResult = {
  protected: ProtectedMedia[];
  syncFailures: string[];
  skipped: number;
};

async function getAllImageAssetIds(): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  while (true) {
    const page = await new MediaLibrary.Query()
      .eq(MediaLibrary.AssetField.MEDIA_TYPE, MediaLibrary.MediaType.IMAGE)
      .orderBy({ key: MediaLibrary.AssetField.CREATION_TIME, ascending: true })
      .limit(ASSET_PAGE_SIZE)
      .offset(offset)
      .exeForMetadata();
    ids.push(...page.map((asset) => asset.id));
    if (page.length < ASSET_PAGE_SIZE) return ids;
    offset += page.length;
  }
}

async function getKnownAssets(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KNOWN_ASSETS_KEY);
  if (!raw) throw new Error("L'initialisation de la photothèque est manquante. Désactivez puis réactivez le scan.");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    throw new Error("L'index local de la photothèque est invalide.");
  }
  return new Set(parsed);
}

async function saveKnownAssets(ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(KNOWN_ASSETS_KEY, JSON.stringify([...ids]));
}

async function requireFullPhotoAccess(request: boolean): Promise<void> {
  const permission = request
    ? await MediaLibrary.requestPermissionsAsync(false, ['photo'])
    : await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (!permission.granted) {
    throw new Error("L'accès aux photos a été refusé. Autorisez l'accès complet dans les réglages pour activer le scan.");
  }
  if (permission.accessPrivileges === 'limited') {
    throw new Error("L'accès limité ne permet pas de détecter toute la photothèque. Choisissez « Toutes les photos » dans les réglages.");
  }
}

export async function isNewImageMonitoringEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(MONITORING_KEY)) === 'true';
}

export async function enableNewImageMonitoring(): Promise<number> {
  await requireFullPhotoAccess(true);
  const existingIds = await getAllImageAssetIds();
  await saveKnownAssets(new Set(existingIds));
  await AsyncStorage.setItem(MONITORING_KEY, 'true');
  return existingIds.length;
}

export async function disableNewImageMonitoring(): Promise<void> {
  await AsyncStorage.setItem(MONITORING_KEY, 'false');
}

export function observeImageLibraryChanges(listener: () => void): { remove: () => void } {
  return MediaLibrary.addListener(listener);
}

export async function scanNewImages(): Promise<LibraryScanResult> {
  if (!(await isNewImageMonitoringEnabled())) {
    return { protected: [], syncFailures: [], skipped: 0 };
  }
  await requireFullPhotoAccess(false);

  const knownIds = await getKnownAssets();
  const currentIds = await getAllImageAssetIds();
  const protectedMedia: ProtectedMedia[] = [];
  const syncFailures: string[] = [];
  let skipped = 0;

  for (const assetId of currentIds) {
    if (knownIds.has(assetId)) continue;

    const asset = new MediaLibrary.Asset(assetId);
    const info = await asset.getInfo();
    if (await hasProtectedAsset(assetId)) {
      knownIds.add(assetId);
      skipped++;
      continue;
    }

    const saved = await protectImage(info.uri, info.filename, assetId);
    knownIds.add(assetId);
    await saveKnownAssets(knownIds);
    protectedMedia.push(saved);

    try {
      await syncProtectedMedia(saved);
      protectedMedia[protectedMedia.length - 1] = { ...saved, syncStatus: 'synced' };
    } catch (error) {
      syncFailures.push(
        `${info.filename}: ${error instanceof Error ? error.message : 'Échec de la synchronisation.'}`
      );
    }
  }

  await saveKnownAssets(knownIds);
  return { protected: protectedMedia, syncFailures, skipped };
}
