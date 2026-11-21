import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HistoryItem, Verdict } from '@/types/verification';

const STORAGE_KEY = 'verification-history-v1';
export const MAX_HISTORY_ITEMS = 30;

const VALID_VERDICTS: Verdict[] = ['true', 'false', 'misleading', 'unverified'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Vérifie qu'un élément lu dans le stockage a bien la forme attendue. */
function isHistoryItem(value: unknown): value is HistoryItem {
  if (!isRecord(value)) return false;
  const { id, input, isUrl, createdAt, result } = value;

  if (typeof id !== 'string') return false;
  if (typeof input !== 'string') return false;
  if (typeof isUrl !== 'boolean') return false;
  if (typeof createdAt !== 'number') return false;
  if (!isRecord(result)) return false;

  return (
    typeof result.verdict === 'string' &&
    VALID_VERDICTS.includes(result.verdict as Verdict) &&
    typeof result.summary === 'string' &&
    Array.isArray(result.keyPoints) &&
    Array.isArray(result.sources)
  );
}

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    return data.filter(isHistoryItem);
  } catch {
    // stockage illisible ou JSON corrompu : on repart d'un historique vide
    return [];
  }
}

export async function saveHistory(items: HistoryItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // l'échec de la sauvegarde ne doit pas bloquer l'utilisateur
  }
}

export async function clearStoredHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignoré
  }
}