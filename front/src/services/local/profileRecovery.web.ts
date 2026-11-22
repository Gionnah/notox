import type { RecoveredProfile } from './profileRecovery.native';

function unavailable(): never {
  throw new Error('La récupération du profil est disponible dans la version mobile de NOTOX.');
}

export async function createEncryptedProfileBackup(_passphrase: string): Promise<string> {
  return unavailable();
}

export async function readEncryptedProfileBackup(
  _serialized: string,
  _passphrase: string
): Promise<RecoveredProfile> {
  return unavailable();
}
