import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as ed25519 from '@noble/ed25519';

import type { ProtectedMedia, ProvenanceCheck } from '@/types/provenance';

const MEDIA_STORAGE_KEY = 'protected-media-v1';
const AUTO_PROTECT_STORAGE_KEY = 'auto-protect-media-v1';
const SIGNING_KEY_STORAGE_KEY = 'provenance-ed25519-private-key-v1';
const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const HEX_64_BYTES = /^[0-9a-f]{128}$/i;

ed25519.hashes.sha512Async = async (message) => {
  const input = Uint8Array.from(message);
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA512, input));
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function signedManifest(media: Pick<ProtectedMedia, 'id' | 'sha256' | 'createdAt'>): Uint8Array {
  return asciiBytes(
    JSON.stringify({
      version: 1,
      id: media.id,
      sha256: media.sha256,
      createdAt: media.createdAt,
    })
  );
}

function validateProtectedMedia(value: unknown): value is ProtectedMedia {
  if (typeof value !== 'object' || value === null) return false;
  const media = value as Record<string, unknown>;

  return (
    typeof media.id === 'string' &&
    typeof media.fileName === 'string' &&
    typeof media.uri === 'string' &&
    typeof media.sha256 === 'string' &&
    HEX_32_BYTES.test(media.sha256) &&
    typeof media.publicKey === 'string' &&
    HEX_32_BYTES.test(media.publicKey) &&
    typeof media.signature === 'string' &&
    HEX_64_BYTES.test(media.signature) &&
    typeof media.createdAt === 'number' &&
    Number.isFinite(media.createdAt) &&
    (media.sourceAssetId === undefined || typeof media.sourceAssetId === 'string') &&
    (media.syncStatus === undefined ||
      media.syncStatus === 'pending' ||
      media.syncStatus === 'synced')
  );
}

function isProtectedMedia(value: unknown): value is ProtectedMedia {
  return validateProtectedMedia(value);
}

async function getSigningKey(): Promise<Uint8Array> {
  const storedKey = await SecureStore.getItemAsync(SIGNING_KEY_STORAGE_KEY);
  if (storedKey) {
    if (!HEX_32_BYTES.test(storedKey)) {
      throw new Error('La clé de signature enregistrée est invalide.');
    }
    return ed25519.etc.hexToBytes(storedKey);
  }

  const privateKey = await Crypto.getRandomBytesAsync(32);
  await SecureStore.setItemAsync(SIGNING_KEY_STORAGE_KEY, bytesToHex(privateKey));
  return privateKey;
}

export async function loadProtectedMedia(): Promise<ProtectedMedia[]> {
  const raw = await AsyncStorage.getItem(MEDIA_STORAGE_KEY);
  if (!raw) return [];

  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || !data.every(isProtectedMedia)) {
    throw new Error("L'historique de provenance enregistré est invalide.");
  }
  return data;
}

export async function loadAutoProtection(): Promise<boolean> {
  const value = await AsyncStorage.getItem(AUTO_PROTECT_STORAGE_KEY);
  if (value === null) return true;
  if (value !== 'true' && value !== 'false') {
    throw new Error("Le réglage de protection automatique est invalide.");
  }
  return value === 'true';
}

export async function saveAutoProtection(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_PROTECT_STORAGE_KEY, String(enabled));
}

export async function protectImage(
  uri: string,
  fileName: string,
  sourceAssetId?: string
): Promise<ProtectedMedia> {
  const source = new File(uri);
  if (!source.exists) {
    throw new Error("Le fichier sélectionné n'est plus accessible.");
  }
  if (source.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Cette image dépasse la taille maximale de 25 Mo.");
  }

  const id = Crypto.randomUUID();
  const extension = /^\.[a-z0-9]{1,8}$/i.test(source.extension) ? source.extension : '.img';
  const destination = new File(Paths.document, `notox-${id}${extension}`);

  await source.copy(destination);
  try {
    const bytes = await destination.bytes();
    if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error("Cette image dépasse la taille maximale de 25 Mo.");
    }

    const sha256 = bytesToHex(
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))
    );
    const createdAt = Date.now();
    const manifest = { id, sha256, createdAt };
    const privateKey = await getSigningKey();
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);
    const signature = await ed25519.signAsync(signedManifest(manifest), privateKey);

    const protectedMedia: ProtectedMedia = {
      ...manifest,
      fileName,
      uri: destination.uri,
      publicKey: bytesToHex(publicKey),
      signature: bytesToHex(signature),
      ...(sourceAssetId ? { sourceAssetId } : {}),
      syncStatus: 'pending',
    };

    const history = await loadProtectedMedia();
    await AsyncStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify([protectedMedia, ...history]));
    return protectedMedia;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function hasProtectedAsset(sourceAssetId: string): Promise<boolean> {
  const media = await loadProtectedMedia();
  return media.some((item) => item.sourceAssetId === sourceAssetId);
}

export async function markProtectedMediaSynced(id: string): Promise<void> {
  const media = await loadProtectedMedia();
  const updated = media.map((item) =>
    item.id === id ? { ...item, syncStatus: 'synced' as const } : item
  );
  await AsyncStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(updated));
}

export async function getSigningPublicKey(): Promise<string> {
  const privateKey = await getSigningKey();
  return bytesToHex(await ed25519.getPublicKeyAsync(privateKey));
}

export async function signRequestMessage(message: string): Promise<string> {
  const privateKey = await getSigningKey();
  return bytesToHex(await ed25519.signAsync(asciiBytes(message), privateKey));
}

export async function verifyProtectedMedia(media: ProtectedMedia): Promise<ProvenanceCheck> {
  const file = new File(media.uri);
  if (!file.exists) {
    throw new Error("Le fichier protégé n'est plus présent sur cet appareil.");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Le fichier dépasse la taille maximale autorisée pour la vérification.");
  }

  const bytes = await file.bytes();
  const currentDigest = bytesToHex(
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))
  );
  const signatureValid = await ed25519.verifyAsync(
    ed25519.etc.hexToBytes(media.signature),
    signedManifest(media),
    ed25519.etc.hexToBytes(media.publicKey)
  );

  return {
    digestMatches: currentDigest === media.sha256,
    signatureValid,
  };
}
