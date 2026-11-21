# Vérificateur d'infos : état des lieux

*Mis à jour le 21 novembre 2026*

## 1. Présentation

Une application mobile qui permet à un utilisateur de **vérifier une information** avant de la croire ou de la partager.

**Parcours :**
1. L'utilisateur colle un **lien** ou un **texte** dans l'onglet « Vérifier » et appuie sur *Vérifier*.
2. L'app envoie la demande au serveur, qui récupère le contenu, le compare à des **sources fiables** et fait analyser le tout par Gemini.
3. L'app affiche le **résultat** dans une fenêtre plein écran : verdict (Vrai, Faux, Trompeur, Non vérifiable), explication, points clés et sources cliquables.
4. Le résultat est **gardé sur le téléphone** (historique) et peut être **partagé**.

**Fonction complémentaire prévue :** une page de **statistiques** montrant globalement les sujets les plus demandés par les utilisateurs.

## 2. Architecture

| Partie | Technologies |
|---|---|
| **Front** (app mobile) | Expo SDK 58, React Native 0.88, Expo Router (onglets natifs), TypeScript, AsyncStorage |
| **Back** (API) | Node.js, Express 5, TypeScript, zod, Cheerio, Apify, SDK Google Gemini |

Légende : ✅ fait · 🟡 partiel ou non validé · ⬜ à faire

## 3. Fonctionnalités et état

### Application mobile

| Fonctionnalité | État | Détail |
|---|---|---|
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
| Gestion d'erreurs en JSON | ⬜ | Une requête invalide renvoie actuellement une page HTML avec la stack trace |
| Limitation de débit, CORS, helmet | ⬜ | Paquets installés mais non branchés |
| Statistiques des sujets | ⬜ | Voir section 5 |
| Tests automatisés, journaux | ⬜ | Aucun |

## 4. Points bloquants

1. **Front et back ne communiquent pas encore** : route, format de requête et format de réponse diffèrent (`/verify` et `{ input, type }` côté app, `/api/` et `{ question, source }` côté serveur).
2. **Pas de sources fiables** : sans elles, Gemini ne peut rien affirmer et renvoie « Non vérifiable ».
3. **Aucune protection** sur l'API : n'importe qui pourrait déclencher des appels payants (Gemini, Apify).
4. **Délais cumulés** : lecture Facebook (6 s) + Apify (jusqu'à 25 s) + Gemini (jusqu'à 20 s) dépassent le délai de 30 s de l'app.

## 5. Fonction prévue : statistiques des sujets

**Objectif :** montrer les thèmes les plus vérifiés par l'ensemble des utilisateurs (santé, politique, économie…).

**Pistes de conception (à valider) :**
- Faire renvoyer un **sujet** (catégorie) par Gemini avec chaque verdict.
- Le serveur ne garde que des **compteurs agrégés** par sujet et par période, **pas le texte soumis**, pour protéger la vie privée.
- Une route de lecture alimente l'écran Statistiques (classement des sujets, évolution).
- Prévoir une base de données côté serveur et informer l'utilisateur de cette collecte anonyme.

## 6. Prochaines étapes proposées

1. Intégrer le script `env.ts` et le service Gemini, puis faire un premier appel réel.
2. Créer la route `POST /api/verify` au format attendu par l'app.
3. Construire la récupération des sources fiables.
4. Ajouter erreurs JSON, limitation de débit, CORS et helmet.
5. Passer l'app en mode réel (`USE_MOCK = false`) et tester de bout en bout sur téléphone.
6. Étendre l'extraction aux liens d'articles.
7. Mettre en place les statistiques.