import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytesAsync,
} from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import type { DigitalProfile } from '@/types/provenance';
import { exportSigningIdentity } from './provenance';
import { isDigitalProfile, loadDigitalProfile } from './profile';

const BACKUP_FORMAT = 'notox-profile-backup';
const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const BACKUP_AAD = utf8ToBytes('NOTOX_PROFILE_BACKUP_V1');

export type RecoveredProfile = {
  privateKey: string;
  publicKey: string;
  profile: DigitalProfile;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error('Le fichier de sauvegarde est corrompu.');
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
}

function bytesToUtf8(bytes: Uint8Array): string {
  const encoded = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(encoded);
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.length < 12) {
    throw new Error('Choisissez une phrase secrète d’au moins 12 caractères.');
  }
  if (passphrase.length > 128) {
    throw new Error('La phrase secrète ne peut pas dépasser 128 caractères.');
  }
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array): Promise<AESEncryptionKey> {
  const keyBytes = await pbkdf2Async(sha256, passphrase, salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
    asyncTick: 10,
  });
  return AESEncryptionKey.import(keyBytes);
}

export async function createEncryptedProfileBackup(passphrase: string): Promise<string> {
  validatePassphrase(passphrase);
  const [identity, profile] = await Promise.all([
    exportSigningIdentity(),
    loadDigitalProfile(),
  ]);
  const plaintext = utf8ToBytes(
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      ...identity,
      profile,
    }),
  );
  const salt = await getRandomBytesAsync(16);
  const key = await deriveEncryptionKey(passphrase, salt);
  const sealed = await aesEncryptAsync(plaintext, key, { additionalData: BACKUP_AAD });
  const ciphertext = await sealed.combined('bytes');
  if (typeof ciphertext === 'string') {
    throw new Error('Impossible de créer le fichier de sauvegarde chiffré.');
  }

  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToHex(salt),
    ciphertext: bytesToHex(ciphertext),
  });
}

export async function readEncryptedProfileBackup(
  serialized: string,
  passphrase: string,
): Promise<RecoveredProfile> {
  validatePassphrase(passphrase);
  if (serialized.length > 16_384) {
    throw new Error('Le fichier de sauvegarde dépasse la taille maximale autorisée.');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    throw new Error('Le fichier de sauvegarde n’est pas un JSON valide.');
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    !('format' in envelope) ||
    envelope.format !== BACKUP_FORMAT ||
    !('version' in envelope) ||
    envelope.version !== BACKUP_VERSION ||
    !('kdf' in envelope) ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    !('iterations' in envelope) ||
    envelope.iterations !== PBKDF2_ITERATIONS ||
    !('salt' in envelope) ||
    typeof envelope.salt !== 'string' ||
    !('ciphertext' in envelope) ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('Le format du fichier de sauvegarde n’est pas pris en charge.');
  }

  const salt = hexToBytes(envelope.salt);
  const ciphertext = hexToBytes(envelope.ciphertext);
  if (salt.length !== 16 || ciphertext.length < 28) {
    throw new Error('Le fichier de sauvegarde est incomplet ou corrompu.');
  }

  let plaintext: Uint8Array;
  try {
    const key = await deriveEncryptionKey(passphrase, salt);
    plaintext = await aesDecryptAsync(
      AESSealedData.fromCombined(ciphertext),
      key,
      { output: 'bytes', additionalData: BACKUP_AAD },
    );
  } catch {
    throw new Error('Phrase secrète incorrecte ou fichier de sauvegarde altéré.');
  }

  let recovered: unknown;
  try {
    recovered = JSON.parse(bytesToUtf8(plaintext));
  } catch {
    throw new Error('Les données déchiffrées du profil sont invalides.');
  }
  if (
    typeof recovered !== 'object' ||
    recovered === null ||
    !('format' in recovered) ||
    recovered.format !== BACKUP_FORMAT ||
    !('version' in recovered) ||
    recovered.version !== BACKUP_VERSION ||
    !('privateKey' in recovered) ||
    typeof recovered.privateKey !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(recovered.privateKey) ||
    !('publicKey' in recovered) ||
    typeof recovered.publicKey !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(recovered.publicKey) ||
    !('profile' in recovered) ||
    !isDigitalProfile(recovered.profile)
  ) {
    throw new Error('Les données déchiffrées du profil sont invalides.');
  }

  return {
    privateKey: recovered.privateKey.toLowerCase(),
    publicKey: recovered.publicKey.toLowerCase(),
    profile: recovered.profile,
  };
}

