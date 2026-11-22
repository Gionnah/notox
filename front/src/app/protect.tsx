import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  analyzePageUrl,
  localizeProtectedMedia,
  syncProtectedMedia,
  type ManipulationLocalization,
  type UrlAnalysisReport,
} from '@/services/api/provenance';
import {
  loadAutoProtection,
  loadProtectedMedia,
  markProtectedMediaSynced,
  protectImage,
  saveAutoProtection,
  verifyProtectedMedia,
} from '@/services/local/provenance';
import {
  disableNewImageMonitoring,
  enableNewImageMonitoring,
  isNewImageMonitoringEnabled,
  observeImageLibraryChanges,
  scanNewImages,
} from '@/services/local/mediaLibraryScanner';
import type { ProtectedMedia } from '@/types/provenance';

type SelectedImage = {
  uri: string;
  fileName: string;
};

const RECENT_COUNT = 10;

export default function ProtectScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const [media, setMedia] = useState<ProtectedMedia[]>([]);
  const [autoProtect, setAutoProtect] = useState<boolean | null>(null);
  const [pendingImage, setPendingImage] = useState<SelectedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [localizingId, setLocalizingId] = useState<string | null>(null);
  const [localizationReports, setLocalizationReports] = useState<
    Record<string, ManipulationLocalization>
  >({});
  const [galleryMonitoring, setGalleryMonitoring] = useState(false);
  const [scanSummary, setScanSummary] = useState('');
  const [url, setUrl] = useState('');
  const [report, setReport] = useState<UrlAnalysisReport | null>(null);
  const scanInProgress = useRef(false);
  const scanRequestedAgain = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let active = true;
    Promise.all([loadAutoProtection(), loadProtectedMedia(), isNewImageMonitoringEnabled()])
      .then(([enabled, savedMedia, monitoring]) => {
        if (!active) return;
        setAutoProtect(enabled);
        setMedia(savedMedia);
        setGalleryMonitoring(monitoring);
      })
      .catch((error: unknown) => {
        if (active) Alert.alert('Chargement impossible', getErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  const runGalleryScan = useCallback(async () => {
    if (scanInProgress.current) {
      scanRequestedAgain.current = true;
      return;
    }
    scanInProgress.current = true;
    setBusy(true);
    try {
      const result = await scanNewImages();
      if (result.protected.length > 0) {
        setMedia((current) => [
          ...result.protected.filter((item) => !current.some((saved) => saved.id === item.id)),
          ...current,
        ]);
      }
      const summary =
        result.protected.length > 0 || result.skipped > 0
          ? `${result.protected.length} nouvelle(s) image(s) protégée(s), ${result.skipped} déjà protégée(s).`
          : "Aucune nouvelle image détectée dans la photothèque.";
      setScanSummary(summary);
      if (result.syncFailures.length > 0) {
        Alert.alert(
          'Images protégées, synchronisation incomplète',
          `${result.syncFailures.length} image(s) sont restées sur cet appareil sans empreinte IA distante.\n${result.syncFailures.slice(0, 3).join('\n')}`
        );
      }
    } catch (error) {
      Alert.alert('Scan de la photothèque impossible', getErrorMessage(error));
    } finally {
      scanInProgress.current = false;
      setBusy(false);
      if (scanRequestedAgain.current) {
        scanRequestedAgain.current = false;
        setTimeout(() => void runGalleryScan(), 0);
      }
    }
  }, []);

  useEffect(() => {
    if (!galleryMonitoring || Platform.OS === 'web') return;

    const subscription = observeImageLibraryChanges(() => {
      void runGalleryScan();
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runGalleryScan();
    });
    void runGalleryScan();

    return () => {
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [galleryMonitoring, runGalleryScan]);

  const protectSelectedImage = async (image: SelectedImage) => {
    setBusy(true);
    try {
      const saved = await protectImage(image.uri, image.fileName);
      let updated = saved;
      if (galleryMonitoring) {
        try {
          await syncProtectedMedia(saved);
          updated = { ...saved, syncStatus: 'synced' };
        } catch (error) {
          Alert.alert(
            'Image protégée sur cet appareil',
            `La synchronisation et l’analyse IA n’ont pas abouti : ${getErrorMessage(error)}`
          );
        }
      }
      setMedia((current) => [updated, ...current]);
      setPendingImage(null);
      if (updated.syncStatus === 'synced') {
        Alert.alert('Image protégée', 'Sa signature locale et son empreinte visuelle distante sont enregistrées.');
      } else {
        Alert.alert('Image protégée', 'Son empreinte et sa signature sont enregistrées sur cet appareil.');
      }
    } catch (error) {
      Alert.alert('Protection impossible', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSelectedImage = async (asset: ImagePicker.ImagePickerAsset) => {
    const image = {
      uri: asset.uri,
      fileName: asset.fileName ?? `image-${Date.now()}`,
    };
    setPendingImage(image);
    if (autoProtect) {
      await protectSelectedImage(image);
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Autorisation requise', "Autorisez l'accès à l'appareil photo pour prendre une image.");
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });

      if (!result.canceled) await handleSelectedImage(result.assets[0]);
    } catch (error) {
      Alert.alert('Accès aux images impossible', getErrorMessage(error));
    }
  };

  const changeAutoProtection = async (enabled: boolean) => {
    setBusy(true);
    try {
      await saveAutoProtection(enabled);
      setAutoProtect(enabled);
      if (enabled && pendingImage) await protectSelectedImage(pendingImage);
    } catch (error) {
      Alert.alert('Réglage non enregistré', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const checkSignature = async (item: ProtectedMedia) => {
    setVerifyingId(item.id);
    try {
      const check = await verifyProtectedMedia(item);
      if (check.digestMatches && check.signatureValid) {
        Alert.alert('Vérification réussie', "L'image correspond à son empreinte et sa signature est valide.");
      } else {
        Alert.alert(
          'Vérification échouée',
          `Empreinte de l'image : ${check.digestMatches ? 'valide' : 'différente'}.\nSignature : ${check.signatureValid ? 'valide' : 'invalide'}.`
        );
      }
    } catch (error) {
      Alert.alert('Vérification impossible', getErrorMessage(error));
    } finally {
      setVerifyingId(null);
    }
  };

  const localizeManipulation = async (item: ProtectedMedia) => {
    setBusy(true);
    setLocalizingId(item.id);
    try {
      const result = await localizeProtectedMedia(item);
      setLocalizationReports((current) => ({ ...current, [item.id]: result }));
    } catch (error) {
      Alert.alert('Localisation impossible', getErrorMessage(error));
    } finally {
      setLocalizingId(null);
      setBusy(false);
    }
  };

  const handleGalleryMonitoring = (enabled: boolean) => {
    if (!enabled) {
      void disableNewImageMonitoring()
        .then(() => {
          setGalleryMonitoring(false);
          setScanSummary('La surveillance de la photothèque est désactivée.');
        })
        .catch((error: unknown) =>
          Alert.alert('Désactivation impossible', getErrorMessage(error))
        );
      return;
    }

    Alert.alert(
      'Activer la protection automatique',
      "NOTOX demande l’accès complet aux photos et enregistre la liste des images déjà présentes sans les modifier ni les envoyer. Seules les images ajoutées après l’activation seront protégées. Lorsqu’une nouvelle image est détectée, une copie est analysée par le serveur NOTOX et Google Gemini ; l’original reste intact et n’est pas conservé sur le serveur. Le scan se fait quand l’app est ouverte ou revient au premier plan, sans garantie en arrière-plan.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Autoriser',
          onPress: () => {
            setBusy(true);
            void enableNewImageMonitoring()
              .then((existingCount) => {
                setGalleryMonitoring(true);
                setScanSummary(
                  `Photothèque initialisée : ${existingCount} image(s) déjà présentes ignorées.`
                );
              })
              .catch((error: unknown) =>
                Alert.alert('Activation impossible', getErrorMessage(error))
              )
              .finally(() => setBusy(false));
          },
        },
      ]
    );
  };

  const retrySync = async (item: ProtectedMedia) => {
    setVerifyingId(item.id);
    try {
      await syncProtectedMedia(item);
      await markProtectedMediaSynced(item.id);
      setMedia((current) =>
        current.map((saved) =>
          saved.id === item.id ? { ...saved, syncStatus: 'synced' } : saved
        )
      );
      Alert.alert('Synchronisation réussie', 'L’empreinte visuelle est enregistrée sur le serveur.');
    } catch (error) {
      Alert.alert('Synchronisation impossible', getErrorMessage(error));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleAnalyzeUrl = async () => {
    setBusy(true);
    try {
      const result = await analyzePageUrl(url);
      setReport(result);
    } catch (error) {
      Alert.alert('Analyse impossible', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.unavailable}>
        <ThemedText type="subtitle">Protection des images</ThemedText>
        <ThemedText style={styles.description} themeColor="textSecondary">
          La capture et la signature locale sont disponibles dans l’application mobile NOTOX.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingTop: safeAreaInsets.top + Spacing.three,
          paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.four,
          paddingLeft: safeAreaInsets.left + Spacing.four,
          paddingRight: safeAreaInsets.right + Spacing.four,
        },
      ]}
    >
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          <ThemedText type="subtitle">Protéger un média</ThemedText>
          <ThemedText style={styles.description} themeColor="textSecondary">
            Capturez une image ou importez-la : NOTOX crée son empreinte SHA-256 et la signe sur cet appareil.
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.notice}>
          <ThemedText type="small">
            Les originaux ne sont jamais modifiés. Le scan complet est facultatif : NOTOX mémorise d’abord les images
            déjà présentes et ne traite que les nouveaux éléments.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Si le scan est activé, une copie est envoyée au serveur puis à Google Gemini pour créer une empreinte
            visuelle. Seules les signatures, empreintes et vecteurs sont conservés par NOTOX, pas les images originales.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.setting}>
          <ThemedView style={styles.settingText}>
            <ThemedText type="smallBold">Protection automatique</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Signer dès qu’une image est capturée ou importée
            </ThemedText>
          </ThemedView>
          <Switch
            value={autoProtect ?? false}
            onValueChange={changeAutoProtection}
            disabled={autoProtect === null || busy}
            accessibilityLabel="Protection automatique des images"
          />
        </ThemedView>

        <Pressable
          onPress={() => pickImage('camera')}
          disabled={autoProtect === null || busy}
          accessibilityRole="button"
          style={[styles.button, (autoProtect === null || busy) && styles.disabled]}
        >
          <ThemedText type="smallBold" style={styles.buttonText}>
            Prendre une photo
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => pickImage('library')}
          disabled={autoProtect === null || busy}
          accessibilityRole="button"
          style={[styles.button, styles.secondaryButton, (autoProtect === null || busy) && styles.disabled]}
        >
          <ThemedText type="smallBold" style={styles.secondaryButtonText}>
            Importer une image
          </ThemedText>
        </Pressable>

        <ThemedView type="backgroundElement" style={styles.monitorCard}>
          <ThemedView style={styles.setting}>
            <ThemedView style={styles.settingText}>
              <ThemedText type="smallBold">Nouvelles images de la photothèque</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Scan à l’ouverture de NOTOX ; les images déjà présentes sont ignorées
              </ThemedText>
            </ThemedView>
            <Switch
              value={galleryMonitoring}
              onValueChange={handleGalleryMonitoring}
              disabled={busy}
              accessibilityLabel="Protection automatique des nouvelles images de la photothèque"
            />
          </ThemedView>
          {galleryMonitoring && (
            <Pressable
              onPress={() => void runGalleryScan()}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.scanButton, busy && styles.disabled]}
            >
              <ThemedText type="smallBold" style={styles.secondaryButtonText}>
                {busy ? 'Scan en cours…' : 'Rechercher de nouvelles images'}
              </ThemedText>
            </Pressable>
          )}
          {scanSummary.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {scanSummary}
            </ThemedText>
          )}
        </ThemedView>

        {busy && (
          <ThemedText style={styles.centered} themeColor="textSecondary">
            {localizingId
              ? 'Analyse IML-ViT des zones suspectes en cours…'
              : 'Création de l’empreinte et de la signature…'}
          </ThemedText>
        )}

        {pendingImage && !busy && (
          <ThemedView type="backgroundElement" style={styles.pendingCard}>
            <Image source={{ uri: pendingImage.uri }} style={styles.pendingImage} contentFit="cover" />
            <ThemedText type="smallBold">{pendingImage.fileName}</ThemedText>
            <Pressable
              onPress={() => protectSelectedImage(pendingImage)}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.button, busy && styles.disabled]}
            >
              <ThemedText type="smallBold" style={styles.buttonText}>
                {autoProtect ? 'Réessayer la protection' : 'Signer et enregistrer'}
              </ThemedText>
            </Pressable>
          </ThemedView>
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Médias protégés
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          La localisation est lancée à la demande : une copie signée est envoyée au serveur NOTOX pour traitement
          IML-ViT. Le fichier original n’est pas modifié et cette analyse n’utilise pas Gemini.
        </ThemedText>
        {media.length === 0 ? (
          <ThemedText style={styles.centered} themeColor="textSecondary">
            Vos images protégées apparaîtront ici.
          </ThemedText>
        ) : (
          <ThemedView style={styles.mediaList}>
            {media.slice(0, RECENT_COUNT).map((item) => (
              <ThemedView key={item.id} type="backgroundElement" style={styles.mediaCard}>
                <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" />
                <ThemedView style={styles.mediaDetails}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.fileName}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(item.createdAt).toLocaleString()}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    SHA-256 : {item.sha256.slice(0, 20)}…
                  </ThemedText>
                  <Pressable
                    onPress={() => void localizeManipulation(item)}
                    disabled={busy || verifyingId !== null || localizingId !== null}
                    accessibilityRole="button"
                    style={styles.verifyButton}
                  >
                    <ThemedText type="smallBold" style={styles.verifyButtonText}>
                      {localizingId === item.id ? 'Calcul de la heatmap…' : 'Localiser les manipulations'}
                    </ThemedText>
                  </Pressable>
                  {localizationReports[item.id] && (
                    <ThemedView style={styles.localizationResult}>
                      <ThemedText type="smallBold">Zones suspectes · IML-ViT</ThemedText>
                      <Image
                        source={{ uri: localizationReports[item.id].heatmapDataUri }}
                        style={[
                          styles.heatmap,
                          {
                            aspectRatio:
                              localizationReports[item.id].imageWidth /
                              localizationReports[item.id].imageHeight,
                          },
                        ]}
                        contentFit="contain"
                      />
                      <ThemedText type="small" themeColor="textSecondary">
                        {localizationReports[item.id].disclaimer}
                      </ThemedText>
                    </ThemedView>
                  )}
                  {item.syncStatus !== 'synced' && (
                    <Pressable
                      onPress={() => void retrySync(item)}
                      disabled={verifyingId !== null || busy || localizingId !== null}
                      accessibilityRole="button"
                      style={styles.verifyButton}
                    >
                      <ThemedText type="smallBold" style={styles.verifyButtonText}>
                        Synchroniser / analyser par IA
                      </ThemedText>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => checkSignature(item)}
                    disabled={verifyingId !== null || busy || localizingId !== null}
                    accessibilityRole="button"
                    style={styles.verifyButton}
                  >
                    <ThemedText type="smallBold" style={styles.verifyButtonText}>
                      {verifyingId === item.id ? 'Vérification…' : 'Vérifier la signature'}
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            ))}
          </ThemedView>
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Rechercher une image sur une page web
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Les images de la page seront comparées aux vecteurs enregistrés dans ton profil. Un score indique une
          ressemblance potentielle, pas une preuve de réutilisation illicite.
        </ThemedText>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://exemple.com/page"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            styles.urlInput,
            {
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.backgroundSelected,
            },
          ]}
        />
        <Pressable
          onPress={() => void handleAnalyzeUrl()}
          disabled={busy || url.trim().length === 0}
          accessibilityRole="button"
          style={[styles.button, (busy || url.trim().length === 0) && styles.disabled]}
        >
          <ThemedText type="smallBold" style={styles.buttonText}>
            {busy ? 'Analyse en cours…' : 'Analyser cette page'}
          </ThemedText>
        </Pressable>
        {report && (
          <ThemedView type="backgroundElement" style={styles.reportCard}>
            <ThemedText type="smallBold">
              Rapport : {report.comparedImageCount} image(s) comparée(s)
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {report.registeredContentCount} contenu(s) dans le profil ·{' '}
              {new Date(report.checkedAt).toLocaleString()} · {report.skippedImageCount} image(s) ignorée(s)
            </ThemedText>
            {report.matches.map((match, index) => (
              <ThemedView key={`${match.imageHash}-${index}`} style={styles.matchRow}>
                <ThemedText type="small" numberOfLines={1}>
                  {match.imageUrl}
                </ThemedText>
                {match.candidates.map((candidate) => (
                  <ThemedText key={candidate.mediaId} type="small" themeColor="textSecondary">
                    Correspondance potentielle : {Math.round(candidate.similarity * 100)} %
                  </ThemedText>
                ))}
              </ThemedView>
            ))}
            <ThemedText type="small" themeColor="textSecondary">
              {report.disclaimer}
            </ThemedText>
          </ThemedView>
        )}
      </ThemedView>
    </ScrollView>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    gap: Spacing.three,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
  },
  notice: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  monitorCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  settingText: {
    flex: 1,
    gap: Spacing.one,
  },
  button: {
    backgroundColor: '#208AEF',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonText: {
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#208AEF',
  },
  secondaryButtonText: {
    color: '#208AEF',
  },
  scanButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#208AEF',
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.45,
  },
  centered: {
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  pendingCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  pendingImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Spacing.two,
  },
  sectionTitle: {
    paddingTop: Spacing.two,
  },
  mediaList: {
    gap: Spacing.two,
  },
  mediaCard: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
  },
  thumbnail: {
    width: 84,
    height: 84,
    borderRadius: Spacing.two,
    backgroundColor: '#d9d9d9',
  },
  mediaDetails: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.one,
    minWidth: 0,
  },
  verifyButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  verifyButtonText: {
    color: '#208AEF',
  },
  localizationResult: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  heatmap: {
    width: '100%',
    maxHeight: 240,
    borderRadius: Spacing.two,
    backgroundColor: '#111827',
  },
  urlInput: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  reportCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  matchRow: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#999999',
  },
  unavailable: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
