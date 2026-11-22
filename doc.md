# NOTOX : état des lieux

*Mis à jour le 22 novembre 2026*

## 1. Présentation

Une application mobile qui permet de **vérifier une information** avant de la croire ou de la partager, et de **préserver la provenance des images** créées ou importées dans l'app.

**Parcours :**
1. L'utilisateur colle un **lien** ou un **texte** dans l'onglet « Vérifier » et appuie sur *Vérifier*.
2. L'app envoie la demande au serveur, qui récupère le contenu, le compare à des **sources fiables** et fait analyser le tout par Gemini.
3. L'app affiche le **résultat** dans une fenêtre plein écran : verdict (Vrai, Faux, Trompeur, Non vérifiable), explication, points clés et sources cliquables.
4. Le résultat est **gardé sur le téléphone** (historique) et peut être **partagé**.
5. Dans l'onglet « Protéger », l'utilisateur prend ou importe une image ; par défaut, l'app enregistre automatiquement une empreinte SHA-256 et la signe avec une clé Ed25519 locale.

**Fonction complémentaire prévue :** une page de **statistiques** montrant globalement les sujets les plus demandés par les utilisateurs.

## 2. Architecture

| Partie | Technologies |
|---|---|
| **Front** (app mobile) | Expo SDK 58, React Native 0.88, Expo Router (onglets natifs), TypeScript, AsyncStorage |
| **Back** (API) | Node.js, Express 5, TypeScript, zod, Cheerio, Apify, SDK Google Gemini |

La signature de provenance est créée sur l'appareil. La clé privée est conservée dans SecureStore ; une copie privée, son empreinte, sa signature et sa clé publique sont enregistrées localement. Si l'utilisateur active la synchronisation, une copie est envoyée au serveur puis à Google Gemini pour calculer un vecteur visuel : NOTOX conserve le vecteur et les métadonnées signées, pas le fichier original.

Légende : ✅ fait · 🟡 partiel ou non validé · ⬜ à faire

## 3. Fonctionnalités et état

### Application mobile

| Fonctionnalité | État | Détail |
|---|---|---|
| Capture ou import d'image | ✅ | Onglet « Protéger », via les interfaces système de caméra et de galerie |
| Protection automatique d'une image sélectionnée | ✅ | Réglage activé par défaut ; empreinte SHA-256 et signature Ed25519 après capture/import |
| Historique local des médias protégés | ✅ | Copie dans l'espace privé de l'app, signature vérifiable depuis l'historique |
| Détection des nouvelles images de la photothèque | 🟡 | Consentement et accès complet requis ; inventaire initial ignoré, scan à l'ouverture/au retour au premier plan et événements actifs, sans garantie en arrière-plan |
| Synchronisation des preuves et recherche visuelle | 🟡 | Upload temporaire, validation SHA-256/Ed25519, vecteur Gemini 768 dimensions conservé ; requiert `GEMINI_API_KEY` |
| Analyse d'URL et rapport de similarité | 🟡 | Analyse d'une page HTML publique, jusqu'à 8 images, URL HTTP(S) et ports standards ; résultats indicatifs, non juridiques |
| Profil numérique pseudonyme | 🟡 | Nom et bio, visibilité privée par défaut, avatar généré, page publique partageable avec preuves facultatives |
| Récupération de l'identité | ✅ | Export JSON chiffré par phrase secrète (PBKDF2-SHA256 + AES-GCM) ; ne contient pas les images |
| Provenance C2PA / vidéo | ⬜ | Non implémentées ; les signatures ne certifient pas l'identité humaine ni l'origine de la capture |
| Saisie d'un texte ou d'un lien + bouton Vérifier | ✅ | Détection « lien » ou « texte », bouton désactivé si le champ est vide |
| Fenêtre de résultat plein écran | ✅ | Coins arrondis, bouton Fermer, états chargement, erreur (avec Réessayer) et succès |
| Affichage du verdict, du résumé et des points clés | ✅ | Badge coloré selon le verdict |
| Sources cliquables | ✅ | Ouverture dans le navigateur intégré |
| Bouton Partager | ✅ | Partage natif : verdict, résumé et sources |
| Historique local | 🟡 | Stockage sur l'appareil, 30 entrées maximum, 5 affichées sur l'accueil. Code livré, à valider sur appareil |
| Connexion au vrai back | ⬜ | Le service front utilise encore des **données fictives** (`USE_MOCK = true`) |
| Écran Statistiques | ⬜ | Simple placeholder pour l'instant |
| Finitions | ⬜ | Icônes d'onglets provisoires, libellé « States » à traduire, code de démo du template à supprimer |

### Serveur

| Fonctionnalité | État | Détail |
|---|---|---|
| Validation des requêtes | ✅ | zod, limite de 15 000 caractères |
| Extraction d'un texte collé | ✅ | Nettoyage et troncature (testé) |
| Extraction d'un lien Facebook | ✅ | Lecture directe puis secours Apify. |
| Extraction des autres liens (articles de presse…) | ⬜ | Evolution |
| Service Gemini (analyse + verdict en JSON typé) | 🟡 | En cours |
| Récupération des sources fiables | ⬜ | Le service Gemini attend des extraits de sources en entrée : cette étape reste à construire |
| Route `POST /api/verify` compatible avec l'app | ⬜ | Aujourd'hui : route `POST /api/` avec un autre format de requête et de réponse |
| Gestion d'erreurs en JSON | ✅ | Middleware global ; les erreurs internes ne révèlent pas leur détail au client |
| Limitation de débit, CORS, helmet | 🟡 | CORS et Helmet globaux ; limite de débit actuellement appliquée aux routes provenance uniquement |
| Statistiques des sujets | ⬜ | Voir section 5 |
| Tests automatisés, journaux | ⬜ | Aucun |

## 4. Configuration et limites

Créer `back/.env` à partir de `back/.env.example`, puis configurer `GEMINI_API_KEY`. Définir `EXPO_PUBLIC_API_URL` dans `front/.env` avec l'adresse joignable du serveur (sur un téléphone, utiliser l'adresse réseau du poste, pas `localhost`). La base SQLite est créée à `PROVENANCE_DB_PATH` (par défaut `back/data/notox.sqlite`).

L'accès à toute la photothèque dépend des permissions iOS/Android et des règles des boutiques. L'application ne modifie pas les originaux : elle les copie dans son espace privé, mais la détection n'est pas garantie lorsque l'application est suspendue ou arrêtée. Seules les images sont traitées, pas les vidéos.

Les vecteurs visuels sont fournis par Gemini et servent à classer des ressemblances ; ils ne prouvent pas la propriété ou une violation. Le profil est actuellement pseudonyme (clé publique), sans compte humain vérifié. C2PA et une preuve juridique de propriété ne sont pas fournis.

## 5. Points bloquants

1. **Front et back ne communiquent pas encore** : route, format de requête et format de réponse diffèrent (`/verify` et `{ input, type }` côté app, `/api/` et `{ question, source }` côté serveur).
2. **Pas de sources fiables** : sans elles, Gemini ne peut rien affirmer et renvoie « Non vérifiable ».
3. **Contrôle de coût incomplet** : pas d'authentification et pas encore de limite de débit dédiée sur la route générale de vérification.
4. **Délais cumulés** : lecture Facebook (6 s) + Apify (jusqu'à 25 s) + Gemini (jusqu'à 20 s) dépassent le délai de 30 s de l'app.

## 6. Fonction prévue : statistiques des sujets

**Objectif :** montrer les thèmes les plus vérifiés par l'ensemble des utilisateurs (santé, politique, économie…).

**Pistes de conception (à valider) :**
- Faire renvoyer un **sujet** (catégorie) par Gemini avec chaque verdict.
- Le serveur ne garde que des **compteurs agrégés** par sujet et par période, **pas le texte soumis**, pour protéger la vie privée.
- Une route de lecture alimente l'écran Statistiques (classement des sujets, évolution).
- Prévoir une base de données côté serveur et informer l'utilisateur de cette collecte anonyme.

## 7. Prochaines étapes proposées

1. Tester sur appareil la capture, l'import, la persistance du fichier et la vérification de signature.
2. Intégrer le script `env.ts` et le service Gemini, puis faire un premier appel réel.
3. Créer la route `POST /api/verify` au format attendu par l'app.
4. Construire la récupération des sources fiables.
5. Ajouter une limite de débit sur les routes générales de vérification.
6. Passer l'app en mode réel (`USE_MOCK = false`) et tester de bout en bout sur téléphone.
7. Étendre l'extraction aux liens d'articles et mettre en place les statistiques.
8. Valider le scan sur appareils physiques, puis étudier C2PA et une tâche en arrière-plan compatible avec les permissions des plateformes.