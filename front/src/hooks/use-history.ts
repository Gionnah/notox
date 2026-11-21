import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearStoredHistory,
  loadHistory,
  MAX_HISTORY_ITEMS,
  saveHistory,
} from '@/services/local/history';
import type { HistoryItem, VerificationResult } from '@/types/verification';

export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const itemsRef = useRef<HistoryItem[]>([]);

  useEffect(() => {
    let active = true;

    loadHistory().then((stored) => {
      if (!active) return;

      // on garde ce qui aurait été ajouté pendant le chargement
      const current = itemsRef.current;
      const merged = [...current, ...stored.filter((s) => !current.some((c) => c.id === s.id))];

      itemsRef.current = merged;
      setItems(merged);
    });

    return () => {
      active = false;
    };
  }, []);

  const addItem = useCallback((input: string, isUrl: boolean, result: VerificationResult) => {
    const item: HistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      input,
      isUrl,
      createdAt: Date.now(),
      result,
    };

    // une même info revérifiée remplace l'ancienne entrée
    const next = [item, ...itemsRef.current.filter((i) => i.input !== input)].slice(
      0,
      MAX_HISTORY_ITEMS,
    );

    itemsRef.current = next;
    setItems(next);
    void saveHistory(next);
  }, []);

  const clear = useCallback(() => {
    itemsRef.current = [];
    setItems([]);
    void clearStoredHistory();
  }, []);

  return { items, addItem, clear };
}