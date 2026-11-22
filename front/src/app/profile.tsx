import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TextInput,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPublicProfileUrl, updateDigitalProfile } from '@/services/api/provenance';
import {
  getSigningPublicKey,
  importSigningIdentity,
} from '@/services/local/provenance';
import {
  DEFAULT_DIGITAL_PROFILE,
  loadDigitalProfile,
  saveDigitalProfile,
} from '@/services/local/profile';
import {
  createEncryptedProfileBackup,
  readEncryptedProfileBackup,
  type RecoveredProfile,
} from '@/services/local/profileRecovery';
import type { DigitalProfile } from '@/types/provenance';

const MAX_BACKUP_BYTES = 16 * 1024;
const AVATAR_COLORS = ['#2878C8', '#7356B5', '#18846A', '#C45A37', '#A54578', '#52733C'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [profile, setProfile] = useState<DigitalProfile | null>(null);
  const [draft, setDraft] = useState<DigitalProfile>(DEFAULT_DIGITAL_PROFILE);
  const [publicKey, setPublicKey] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupContent, setBackupContent] = useState('');
  const [backupFilename, setBackupFilename] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let active = true;
    Promise.all([loadDigitalProfile(), getSigningPublicKey()])
      .then(([savedProfile, key]) => {
        if (!active) return;
        setProfile(savedProfile);
        setDraft(savedProfile);
        setPublicKey(key);
      })
      .catch((error: unknown) => {
        if (active) Alert.alert('Chargement du profil impossible', getErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  const saveProfile = async () => {
    if (!profile) return;
    const next = {
      ...draft,
      displayName: draft.displayName.trim(),
      bio: draft.bio.trim(),
      showMedia: draft.isPublic && draft.showMedia,
    };
    if (next.isPublic && next.displayName.length === 0) {
      Alert.alert('Nom requis', 'Ajoutez un nom d’affichage avant de publier votre profil.');
      return;
    }

    setBusy(true);
    try {
      if (profile.isPublic || next.isPublic) {
        await updateDigitalProfile(next);
      }
      await saveDigitalProfile(next);
      setProfile(next);
      setDraft(next);
      Alert.alert(
        'Profil enregistré',
        next.isPublic
          ? 'Les informations choisies sont visibles sur votre page publique.'
          : 'Le profil est privé. Son nom et sa présentation restent sur cet appareil.',
      );
    } catch (error) {
      Alert.alert('Enregistrement impossible', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const shareProfile = async () => {
    try {
      const url = await getPublicProfileUrl();
      await Share.share({ message: url });
    } catch (error) {
      Alert.alert('Partage impossible', getErrorMessage(error));
    }
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const encryptedBackup = await createEncryptedProfileBackup(backupPassphrase);
      const file = new File(Paths.cache, `notox-profile-backup-${Crypto.randomUUID()}.json`);
      file.create();
      await file.write(encryptedBackup);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Le partage de fichiers n'est pas disponible sur cet appareil.");
      }
      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Exporter la sauvegarde chiffrée NOTOX',
        mimeType: 'application/json',
      });
    } catch (error) {
      Alert.alert('Export impossible', getErrorMessage(error));
    } finally {
      setBackupPassphrase('');
      setBusy(false);
    }
  };

  const chooseBackupFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('Aucun fichier de sauvegarde sélectionné.');
      if (asset.size !== undefined && asset.size > MAX_BACKUP_BYTES) {
        throw new Error('Le fichier de sauvegarde dépasse la taille maximale autorisée.');
      }
      const content = await new File(asset.uri).text();
      if (content.length > MAX_BACKUP_BYTES) {
        throw new Error('Le fichier de sauvegarde dépasse la taille maximale autorisée.');
      }
      setBackupContent(content);
      setBackupFilename(asset.name);
    } catch (error) {
      Alert.alert('Ouverture du fichier impossible', getErrorMessage(error));
    }
  };

  const applyRecoveredProfile = async (recovered: RecoveredProfile) => {
    setBusy(true);
    try {
      await importSigningIdentity(recovered.privateKey, recovered.publicKey);
      await saveDigitalProfile(recovered.profile);
      setPublicKey(recovered.publicKey);
      setProfile(recovered.profile);
      setDraft(recovered.profile);
      setBackupContent('');
      setBackupFilename('');

      try {
        await updateDigitalProfile(recovered.profile);
      } catch (error) {
        Alert.alert(
          'Identité restaurée, synchronisation en attente',
          `La clé et le profil local ont été restaurés, mais les paramètres serveur n’ont pas pu être synchronisés. Une page précédemment publiée peut rester visible jusqu’à la prochaine synchronisation : ${getErrorMessage(error)}`,
        );
        return;
      }
      Alert.alert(
        'Profil restauré',
        'Votre clé de signature et vos paramètres sont restaurés. Les images et leurs copies locales ne sont pas incluses dans cette sauvegarde.',
      );
    } catch (error) {
      Alert.alert('Restauration impossible', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    setBusy(true);
    try {
      if (!backupContent) throw new Error('Choisissez d’abord votre fichier de sauvegarde.');
      const recovered = await readEncryptedProfileBackup(backupContent, backupPassphrase);
      const currentIdentity = await getSigningPublicKey();
      if (currentIdentity === recovered.publicKey) {
        Alert.alert(
          'Identité déjà active',
          'Cette sauvegarde correspond déjà au profil utilisé sur cet appareil.',
          [{ text: 'OK' }],
        );
        return;
      }
      Alert.alert(
        'Remplacer l’identité de cet appareil ?',
        'La clé de signature actuelle sera remplacée par celle de la sauvegarde. Les images locales ne seront pas supprimées, mais elles resteront liées à leur clé d’origine.',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Restaurer',
            style: 'destructive',
            onPress: () => void applyRecoveredProfile(recovered),
          },
        ],
      );
    } catch (error) {
      Alert.alert('Sauvegarde invalide', getErrorMessage(error));
    } finally {
      setBackupPassphrase('');
      setBusy(false);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.unavailable}>
        <ThemedText type="subtitle">Profil numérique</ThemedText>
        <ThemedText themeColor="textSecondary">
          La gestion et la récupération du profil sont disponibles dans l’application mobile NOTOX.
        </ThemedText>
      </ThemedView>
    );
  }

  const avatarColor = AVATAR_COLORS[Number.parseInt(publicKey.slice(0, 2) || '00', 16) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.three,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          paddingLeft: insets.left + Spacing.four,
          paddingRight: insets.right + Spacing.four,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          <ThemedText type="subtitle">Profil numérique</ThemedText>
          <ThemedText themeColor="textSecondary">
            Votre clé publique identifie ce profil pseudonyme. Elle ne vérifie pas votre identité civile.
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.identityCard}>
          <ThemedView style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <ThemedText type="subtitle" style={styles.avatarText}>
              {getInitials(draft.displayName)}
            </ThemedText>
          </ThemedView>
          <ThemedView style={styles.identityDetails}>
            <ThemedText type="smallBold">
              {draft.displayName.trim() || 'Profil NOTOX'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {publicKey ? `${publicKey.slice(0, 20)}…${publicKey.slice(-8)}` : 'Création de la clé…'}
            </ThemedText>
          </ThemedView>
        </ThemedView>

        <ThemedText type="smallBold">Nom d’affichage</ThemedText>
        <TextInput
          value={draft.displayName}
          onChangeText={(displayName) => setDraft((current) => ({ ...current, displayName }))}
          placeholder="Votre pseudonyme"
          placeholderTextColor={theme.textSecondary}
          maxLength={50}
          autoCapitalize="words"
          editable={!busy}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Jusqu’à 50 caractères. Obligatoire pour publier le profil.
        </ThemedText>

        <ThemedText type="smallBold">Présentation</ThemedText>
        <TextInput
          value={draft.bio}
          onChangeText={(bio) => setDraft((current) => ({ ...current, bio }))}
          placeholder="Présentez votre activité de création (facultatif)"
          placeholderTextColor={theme.textSecondary}
          maxLength={160}
          multiline
          editable={!busy}
          textAlignVertical="top"
          style={[styles.input, styles.bioInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {draft.bio.length}/160 · L’avatar est généré à partir de vos initiales et de votre clé publique ; aucune photo de profil n’est téléversée.
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.settingCard}>
          <ThemedView style={styles.setting}>
            <ThemedView style={styles.settingCopy}>
              <ThemedText type="smallBold">Publier mon profil</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Désactivé par défaut. Le nom et la présentation ne sont publiés qu’après activation.
              </ThemedText>
            </ThemedView>
            <Switch
              value={draft.isPublic}
              onValueChange={(isPublic) =>
                setDraft((current) => ({
                  ...current,
                  isPublic,
                  showMedia: isPublic && current.showMedia,
                }))
              }
              disabled={busy || profile === null}
              accessibilityLabel="Publier mon profil numérique"
            />
          </ThemedView>
          <ThemedView style={styles.setting}>
            <ThemedView style={styles.settingCopy}>
              <ThemedText type="smallBold">Afficher les preuves des médias</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Rend publiques les empreintes, dates et signatures des médias synchronisés.
              </ThemedText>
            </ThemedView>
            <Switch
              value={draft.showMedia}
              onValueChange={(showMedia) => setDraft((current) => ({ ...current, showMedia }))}
              disabled={busy || profile === null || !draft.isPublic}
              accessibilityLabel="Afficher les preuves des médias sur le profil public"
            />
          </ThemedView>
        </ThemedView>

        <Pressable
          onPress={() => void saveProfile()}
          disabled={busy || profile === null}
          accessibilityRole="button"
          style={[styles.primaryButton, (busy || profile === null) && styles.disabled]}
        >
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {busy ? 'Enregistrement…' : 'Enregistrer le profil'}
          </ThemedText>
        </Pressable>

        {profile?.isPublic && (
          <Pressable
            onPress={() => void shareProfile()}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.secondaryButton, busy && styles.disabled]}
          >
            <ThemedText type="smallBold">Partager ma page publique</ThemedText>
          </Pressable>
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Sauvegarde et récupération
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          La sauvegarde contient la clé privée et les paramètres du profil, chiffrés sur cet appareil. Choisissez une phrase secrète d’au moins 12 caractères et conservez-la séparément : NOTOX ne peut pas la récupérer. Les images et leurs fichiers locaux ne sont pas inclus.
        </ThemedText>
        <TextInput
          value={backupPassphrase}
          onChangeText={setBackupPassphrase}
          placeholder="Phrase secrète (12 caractères minimum)"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
          editable={!busy}
        />
        <Pressable
          onPress={() => void exportBackup()}
          disabled={busy || profile === null}
          accessibilityRole="button"
          style={[styles.secondaryButton, (busy || profile === null) && styles.disabled]}
        >
          <ThemedText type="smallBold">Exporter la sauvegarde chiffrée</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => void chooseBackupFile()}
          disabled={busy}
          accessibilityRole="button"
          style={[styles.secondaryButton, busy && styles.disabled]}
        >
          <ThemedText type="smallBold">Choisir un fichier de sauvegarde</ThemedText>
        </Pressable>
        {backupFilename ? (
          <ThemedText type="small" themeColor="textSecondary">
            Fichier sélectionné : {backupFilename}
          </ThemedText>
        ) : null}
        <Pressable
          onPress={() => void restoreBackup()}
          disabled={busy || profile === null || !backupContent}
          accessibilityRole="button"
          style={[styles.dangerButton, (busy || profile === null || !backupContent) && styles.disabled]}
        >
          <ThemedText type="smallBold" style={styles.dangerButtonText}>
            {busy ? 'Traitement…' : 'Restaurer cette identité'}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toLocaleUpperCase();
  return (parts[0]?.slice(0, 2) || 'N').toLocaleUpperCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  content: { flexDirection: 'row', justifyContent: 'center' },
  container: { maxWidth: MaxContentWidth, flexGrow: 1, gap: Spacing.three },
  header: { gap: Spacing.two, alignItems: 'center' },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff' },
  identityDetails: { flex: 1, gap: Spacing.one },
  input: { borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  bioInput: { minHeight: 96 },
  settingCard: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.three },
  setting: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  settingCopy: { flex: 1, gap: Spacing.one },
  primaryButton: { backgroundColor: '#208AEF', paddingVertical: Spacing.three, borderRadius: Spacing.five, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  primaryButtonText: { color: '#ffffff' },
  secondaryButton: { borderWidth: 1, borderColor: '#208AEF', paddingVertical: Spacing.three, borderRadius: Spacing.five, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  dangerButton: { borderWidth: 1, borderColor: '#D64545', paddingVertical: Spacing.three, borderRadius: Spacing.five, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  dangerButtonText: { color: '#D64545' },
  disabled: { opacity: 0.45 },
  sectionTitle: { marginTop: Spacing.four },
  unavailable: { flex: 1, padding: Spacing.four, gap: Spacing.three, alignItems: 'center', justifyContent: 'center' },
});
