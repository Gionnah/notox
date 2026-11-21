import type {
  Verdict,
  VerificationResult,
  VerificationSource,
  VerifyInput,
} from '@/types/verification';

/**
 * Passez à `false` pour utiliser votre vraie API.
 */
const USE_MOCK = true;

/**
 * URL de votre backend. Définissez-la dans un fichier `.env` à la racine :
 * EXPO_PUBLIC_API_URL=https://votre-api.com
 * (les variables qui commencent par EXPO_PUBLIC_ sont lisibles dans l'app)
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

const REQUEST_TIMEOUT_MS = 30000;

const VALID_VERDICTS: Verdict[] = ['true', 'false', 'misleading', 'unverified'];

/* -------------------------------------------------------------------------- */
/*  Mock                                                                      */
/* -------------------------------------------------------------------------- */

async function verifyWithMock(_payload: VerifyInput): Promise<VerificationResult> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1800));

  return {
    verdict: 'misleading',
    summary:
      "L'information contient une part de vérité, mais le chiffre avancé est sorti de son contexte et l'ampleur du phénomène est exagérée.",
    keyPoints: [
      "Le chiffre cité provient d'une étude de 2019 qui portait sur un échantillon limité.",
      'Les données officielles plus récentes montrent une tendance moins marquée.',
      "La conclusion tirée dans le texte n'est pas soutenue par les sources citées.",
    ],
    sources: [
      {
        name: 'Source exemple 1',
        title: 'Analyse des chiffres officiels',
        url: 'https://example.com/analyse',
      },
      {
        name: 'Source exemple 2',
        title: "Vérification de l'étude originale",
        url: 'https://example.com/etude',
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*  API réelle                                                                */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Vérifie que la réponse du backend a la forme attendue
 * et la convertit en `VerificationResult`.
 */
function parseResult(data: unknown): VerificationResult {
  if (!isRecord(data)) {
    throw new Error('Réponse invalide');
  }

  const { verdict, summary, keyPoints, sources } = data;

  if (typeof verdict !== 'string' || !VALID_VERDICTS.includes(verdict as Verdict)) {
    throw new Error('Verdict invalide');
  }

  if (typeof summary !== 'string') {
    throw new Error('Résumé invalide');
  }

  const parsedKeyPoints: string[] = Array.isArray(keyPoints)
    ? keyPoints.filter((point): point is string => typeof point === 'string')
    : [];

  const parsedSources: VerificationSource[] = Array.isArray(sources)
    ? sources.flatMap((source: unknown): VerificationSource[] => {
        if (!isRecord(source)) return [];
        const { name, title, url } = source;
        if (typeof url !== 'string' || url.length === 0) return [];
        return [
          {
            name: typeof name === 'string' ? name : url,
            title: typeof title === 'string' ? title : url,
            url,
          },
        ];
      })
    : [];

  return {
    verdict: verdict as Verdict,
    summary,
    keyPoints: parsedKeyPoints,
    sources: parsedSources,
  };
}

async function verifyWithApi(payload: VerifyInput): Promise<VerificationResult> {
  if (!API_URL) {
    throw new Error("EXPO_PUBLIC_API_URL n'est pas défini");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Erreur serveur (${response.status})`);
    }

    const data: unknown = await response.json();
    return parseResult(data);
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/*  Point d'entrée                                                            */
/* -------------------------------------------------------------------------- */

export async function verifyInfo(payload: VerifyInput): Promise<VerificationResult> {
  return USE_MOCK ? verifyWithMock(payload) : verifyWithApi(payload);
}