import * as WebBrowser from 'expo-web-browser';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Verdict, VerificationResult, VerificationSource } from '@/types/verification';

export type VerifyStatus = 'loading' | 'success' | 'error';

type VerifyModalProps = {
  visible: boolean;
  onClose: () => void;
  onRetry: () => void;
  status: VerifyStatus;
  result: VerificationResult | null;
  content: string;
  isUrl: boolean;
};

export const VERDICTS: Record<Verdict, { label: string; headline: string; color: string }> = {
  true: {
    label: 'Vrai',
    headline: 'Cette information est vraie',
    color: '#1F9D55',
  },
  false: {
    label: 'Faux',
    headline: 'Cette information est fausse',
    color: '#D64545',
  },
  misleading: {
    label: 'Trompeur',
    headline: 'Cette information est trompeuse',
    color: '#E08A00',
  },
  unverified: {
    label: 'Non vérifiable',
    headline: "Cette information n'a pas pu être vérifiée",
    color: '#6B7280',
  },
};

export function VerifyModal({
  visible,
  onClose,
  onRetry,
  status,
  result,
  content,
  isUrl,
}: VerifyModalProps) {
  const theme = useTheme();

  const verdict = result ? VERDICTS[result.verdict] : null;

  const handleShare = async () => {
    if (!result || !verdict) return;

    const sources = result.sources
      .map((s: VerificationSource) => `- ${s.name} : ${s.url}`)
      .join('\n');
    const message = `${verdict.headline}\n\n${result.summary}\n\nSources :\n${sources}`;

    try {
      await Share.share({ message });
    } catch {
      // l'utilisateur a fermé la feuille de partage ou le partage est indisponible
    }
  };

  const handleOpenSource = (url: string) => {
    WebBrowser.openBrowserAsync(url);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Le Modal est une fenêtre native séparée : on refournit le contexte des safe areas */}
      <SafeAreaProvider>
        {/* Voile sombre + marge du haut (encoche / barre d'état) */}
        <SafeAreaView edges={['top']} style={styles.backdrop}>
          <View style={styles.topGap} />

          {/* Panneau plein écran avec coins supérieurs arrondis */}
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <SafeAreaView edges={['bottom']} style={styles.sheetInner}>
              {/* En-tête */}
              <ThemedView style={styles.header}>
                <ThemedText type="subtitle">Résultat</ThemedText>

                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Fermer"
                  hitSlop={12}
                  style={[styles.closeButton, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText type="smallBold">Fermer</ThemedText>
                </Pressable>
              </ThemedView>

              {/* Contenu */}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <ThemedView style={styles.body}>
                  {/* Élément vérifié */}
                  <ThemedView type="backgroundElement" style={styles.queryBox}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isUrl ? 'Lien analysé' : 'Texte analysé'}
                    </ThemedText>
                    <ThemedText type="small" numberOfLines={3}>
                      {content}
                    </ThemedText>
                  </ThemedView>

                  {/* Chargement */}
                  {status === 'loading' && (
                    <ThemedView style={styles.centerBlock}>
                      <ActivityIndicator size="large" color={theme.text} />
                      <ThemedText themeColor="textSecondary" style={styles.centerText}>
                        Analyse en cours…
                      </ThemedText>
                    </ThemedView>
                  )}

                  {/* Erreur */}
                  {status === 'error' && (
                    <ThemedView style={styles.centerBlock}>
                      <ThemedText type="smallBold" style={styles.centerText}>
                        La vérification a échoué
                      </ThemedText>
                      <ThemedText themeColor="textSecondary" style={styles.centerText}>
                        Vérifiez votre connexion puis réessayez.
                      </ThemedText>
                      <Pressable
                        onPress={onRetry}
                        accessibilityRole="button"
                        style={[styles.retryButton, { backgroundColor: theme.backgroundElement }]}
                      >
                        <ThemedText type="smallBold">Réessayer</ThemedText>
                      </Pressable>
                    </ThemedView>
                  )}

                  {/* Résultat */}
                  {status === 'success' && result && verdict && (
                    <>
                      <ThemedView style={styles.verdictBlock}>
                        <View style={[styles.badge, { backgroundColor: verdict.color }]}>
                          <ThemedText type="smallBold" style={styles.badgeText}>
                            {verdict.label}
                          </ThemedText>
                        </View>
                        <ThemedText type="subtitle">{verdict.headline}</ThemedText>
                        <ThemedText>{result.summary}</ThemedText>
                      </ThemedView>

                      {result.keyPoints.length > 0 && (
                        <ThemedView style={styles.section}>
                          <ThemedText type="smallBold">Points clés</ThemedText>
                          {result.keyPoints.map((point: string, index: number) => (
                            <ThemedView key={`${index}-${point}`} style={styles.pointRow}>
                              <View style={[styles.dot, { backgroundColor: verdict.color }]} />
                              <ThemedText type="small" style={styles.pointText}>
                                {point}
                              </ThemedText>
                            </ThemedView>
                          ))}
                        </ThemedView>
                      )}

                      {result.sources.length > 0 && (
                        <ThemedView style={styles.section}>
                          <ThemedText type="smallBold">Sources</ThemedText>
                          {result.sources.map((source: VerificationSource, index: number) => (
                            <Pressable
                              key={`${source.url}-${index}`}
                              onPress={() => handleOpenSource(source.url)}
                              accessibilityRole="link"
                              style={[
                                styles.sourceCard,
                                {
                                  backgroundColor: theme.backgroundElement,
                                  borderColor: theme.backgroundSelected,
                                },
                              ]}
                            >
                              <ThemedText type="small" themeColor="textSecondary">
                                {source.name}
                              </ThemedText>
                              <ThemedText type="smallBold">{source.title}</ThemedText>
                              <ThemedText type="linkPrimary" numberOfLines={1}>
                                {source.url}
                              </ThemedText>
                            </Pressable>
                          ))}
                        </ThemedView>
                      )}
                    </>
                  )}
                </ThemedView>
              </ScrollView>

              {/* Pied : bouton Partager (visible seulement quand il y a un résultat) */}
              {status === 'success' && result && (
                <ThemedView style={styles.footer}>
                  <Pressable
                    onPress={handleShare}
                    accessibilityRole="button"
                    style={styles.shareButton}
                  >
                    <ThemedText type="smallBold" style={styles.shareText}>
                      Partager
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              )}
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const SHEET_RADIUS = 28;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  topGap: {
    height: Spacing.three,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
  },
  sheetInner: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  closeButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  body: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
  queryBox: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  centerBlock: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  centerText: {
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  verdictBlock: {
    gap: Spacing.three,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  badgeText: {
    color: '#ffffff',
  },
  section: {
    gap: Spacing.two,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
  },
  pointText: {
    flex: 1,
  },
  sourceCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.half,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  shareButton: {
    backgroundColor: '#208AEF',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    alignSelf: 'stretch',
  },
  shareText: {
    color: '#ffffff',
    fontSize: 16,
  },
});