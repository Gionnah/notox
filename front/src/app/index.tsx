import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VerifyModal, type VerifyStatus } from '@/components/pages/verify/verify-modal';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { verifyInfo } from '@/services/verify';
import type { VerificationResult } from '@/types/verification';

const URL_REGEX = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

export default function HomeScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const theme = useTheme();

  const [value, setValue] = useState('');
  const [pressed, setPressed] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [status, setStatus] = useState<VerifyStatus>('loading');
  const [result, setResult] = useState<VerificationResult | null>(null);

  // Permet d'ignorer la réponse d'une requête si la modale a été fermée entre-temps
  const requestId = useRef(0);

  const trimmed = value.trim();
  const isUrl = URL_REGEX.test(trimmed);
  const canSubmit = trimmed.length > 0;

  const runVerification = async () => {
    const id = ++requestId.current;

    setStatus('loading');
    setResult(null);
    setModalVisible(true);

    try {
      const data = await verifyInfo({ input: trimmed, type: isUrl ? 'url' : 'text' });
      if (id !== requestId.current) return;
      setResult(data);
      setStatus('success');
    } catch {
      if (id !== requestId.current) return;
      setStatus('error');
    }
  };

  const handleVerify = () => {
    if (!canSubmit) return;
    runVerification();
  };

  const handleClose = () => {
    requestId.current++;
    setModalVisible(false);
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });

  return (
    <>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: theme.background }]}
        contentInset={insets}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}
      >
        <ThemedView style={styles.container}>
          <ThemedView style={styles.titleContainer}>
            <ThemedText type="subtitle">Vérifier une info</ThemedText>
            <ThemedText style={styles.centerText} themeColor="textSecondary">
              Copier le lien de l'information ou copier son texte ici.
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.form}>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="Collez un texte ou un lien (https://...)"
              placeholderTextColor={theme.textSecondary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />

            {canSubmit && (
              <ThemedText type="small" themeColor="textSecondary">
                {isUrl ? 'Lien détecté' : 'Texte détecté'}
              </ThemedText>
            )}

            <Pressable
              onPress={handleVerify}
              onPressIn={() => setPressed(true)}
              onPressOut={() => setPressed(false)}
              disabled={!canSubmit}
              accessibilityRole="button"
              style={[
                styles.button,
                !canSubmit && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.buttonText}>
                Vérifier
              </ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      </ScrollView>

      <VerifyModal
        visible={modalVisible}
        onClose={handleClose}
        onRetry={runVerification}
        status={status}
        result={result}
        content={trimmed}
        isUrl={isUrl}
      />
    </>
  );
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
  },
  titleContainer: {
    gap: Spacing.three,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  centerText: {
    textAlign: 'center',
  },
  form: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  input: {
    minHeight: 140,
    maxHeight: 280,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#208AEF',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    alignSelf: 'stretch',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});