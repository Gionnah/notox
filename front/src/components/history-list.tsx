import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VERDICTS } from '@/components/verify-modal';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HistoryItem } from '@/types/verification';

type HistoryListProps = {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
};

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function HistoryList({ items, onSelect, onClear }: HistoryListProps) {
  const theme = useTheme();

  if (items.length === 0) return null;

  return (
    <ThemedView style={styles.section}>
      <ThemedView style={styles.header}>
        <ThemedText type="smallBold">Vérifications récentes</ThemedText>

        <Pressable onPress={onClear} accessibilityRole="button" hitSlop={12}>
          <ThemedText type="small" themeColor="textSecondary">
            Tout effacer
          </ThemedText>
        </Pressable>
      </ThemedView>

      {items.map((item: HistoryItem) => {
        const verdict = VERDICTS[item.result.verdict];

        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityLabel={`${verdict.label} : ${item.input}`}
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ]}
          >
            <View style={[styles.badge, { backgroundColor: verdict.color }]}>
              <ThemedText type="smallBold" style={styles.badgeText}>
                {verdict.label}
              </ThemedText>
            </View>

            <ThemedText type="small" numberOfLines={2}>
              {item.input}
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
              {item.isUrl ? 'Lien' : 'Texte'} · {formatDate(item.createdAt)}
            </ThemedText>
          </Pressable>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
    paddingTop: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.one,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 16,
  },
});