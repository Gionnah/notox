# NOTOX

NOTOX est une application mobile Expo qui regroupe un vérificateur de texte/liens et un outil de provenance d’images. La protection d’image associe une empreinte SHA-256 et une signature Ed25519 au fichier ; l’analyse de similarité utilise un vecteur visuel calculé par Gemini.

> Les résultats de vérification et de similarité sont des aides à l’analyse. Ils ne constituent pas une preuve de propriété, d’origine ou de violation juridique.

## Fonctionnalités disponibles

### Vérifier une information

Dans l’onglet **Vérifier** :

1. Collez un texte ou une URL dans le champ.
2. Appuyez sur **Vérifier**.
3. Consultez le verdict, le résumé, les points clés et les sources dans la fenêtre de résultat.
4. Ouvrez une source ou partagez le résultat avec les commandes de la fenêtre.

Les vérifications réussies sont enregistrées localement : les 5 plus récentes sont affichées, jusqu’à 30 entrées sont conservées. Une nouvelle vérification du même texte ou lien remplace l’entrée précédente. **Effacer tout** supprime cet historique local.

**État actuel :** le vérificateur de l’application utilise encore des réponses de démonstration prédéfinies (`USE_MOCK = true` dans `front/src/services/api/verify.ts`). Le backend existant ne renvoie pas encore le format de verdict attendu par l’application. Ne passez pas ce réglage à `false` en pensant activer une vérification réelle : l’intégration devra d’abord être alignée.

### Protéger une image

Dans l’onglet **Protéger** :

1. Activez ou laissez activée **Protection automatique**.
2. Choisissez **Prendre une photo** ou **Importer une image**.
3. Avec la protection automatique activée, l’image est signée dès sa sélection. Si elle est désactivée, l’aperçu permet de lancer **Signer et enregistrer** manuellement.
4. Consultez l’historique des médias protégés et utilisez **Vérifier la signature** pour contrôler l’intégrité de la copie privée.

NOTOX copie l’image dans son espace privé, calcule son empreinte et signe un manifeste avec une clé Ed25519 conservée dans le stockage sécurisé de l’appareil. **Le fichier original n’est pas modifié.**

### Détecter les nouvelles images de la photothèque

L’option **Nouvelles images de la photothèque** est indépendante du réglage de protection automatique :

1. Activez l’option et confirmez le consentement affiché.
2. Accordez l’accès complet à la photothèque lorsque le système le demande.
3. NOTOX mémorise les identifiants des images déjà présentes ; elles sont ignorées et ne sont ni modifiées ni envoyées.
4. Les images ajoutées après l’activation sont détectées lors des événements de photothèque, à l’ouverture de l’écran ou au retour de l’application au premier plan.
5. Pour arrêter la surveillance, désactivez l’option.

Lors d’une nouvelle activation, NOTOX prend un nouvel inventaire : les images déjà présentes à ce moment-là seront ignorées. La détection en arrière-plan n’est pas garantie par iOS ou Android. Les autorisations et les politiques des boutiques peuvent aussi limiter l’accès.

### Synchroniser et analyser des images

Quand la surveillance de la photothèque est activée, les nouvelles images détectées sont protégées et leur copie est synchronisée automatiquement. Une image prise ou importée dans l’écran **Protéger** est également synchronisée si la surveillance est activée. Sinon, elle reste protégée localement ; le bouton **Synchroniser / analyser par IA** permet de réessayer.

Le serveur vérifie la signature et l’empreinte, convertit/redimensionne une copie pour l’analyse Gemini, puis conserve les métadonnées et le vecteur visuel — pas l’image originale. La copie est transmise au serveur et à Google Gemini pour le traitement. Une clé `GEMINI_API_KEY` valide est requise.

### Localiser des manipulations

Dans **Protéger → Médias protégés**, choisissez **Localiser les manipulations**. NOTOX envoie une copie de l’image signée au backend ; celui-ci vérifie son empreinte et sa signature avant de transmettre les octets au service Python local IML-ViT. L’application affiche une heatmap colorée sur l’image normalisée. L’original et sa copie protégée ne sont pas modifiés, et ce parcours n’appelle ni Gemini ni un LLM.

Cette fonction nécessite le dépôt officiel IML-ViT, ses dépendances et un checkpoint obtenus séparément. Le code de démarrage et les instructions sont dans [`back/vision/README.md`](./back/vision/README.md). Le backend renvoie une erreur explicite si le service n’est pas démarré ou si le modèle n’est pas configuré. Le checkpoint n’est pas inclus dans le dépôt ; ses droits d’utilisation doivent être confirmés avant toute distribution commerciale.

La heatmap est un indice probabiliste à examiner, pas une preuve de manipulation, d’origine, de propriété ou d’infraction. Les images plus grandes que 1024 pixels sont réduites pour l’analyse ; de petites modifications peuvent alors devenir moins visibles. Le fonctionnement MPS sur Apple Silicon n’est pas garanti par le dépôt amont et doit être mesuré sur le matériel cible.

### Rechercher une image sur une page web

Dans l’écran **Protéger**, collez l’URL d’une page puis choisissez **Analyser cette page**. Le serveur recherche les images accessibles dans le HTML et compare jusqu’à 8 images au profil associé à la clé publique de l’appareil.

L’analyse nécessite au moins une image synchronisée. Les pages doivent être accessibles publiquement en HTTP(S), sur les ports standards, et renvoyer du HTML. Les ressources privées ou non prises en charge peuvent être ignorées. Le rapport affiche des scores de similarité et un avertissement : un score faible ou élevé n’établit pas à lui seul qu’il s’agit du même fichier ou d’une réutilisation illicite.

Pour cette analyse, le HTML et les images retenues sont traités par le serveur et les images sont transmises à Gemini. La base SQLite conserve l’URL de la page ainsi que le rapport (URLs et empreintes des images comparées, scores) ; elle ne conserve pas les originaux.

### Gérer le profil numérique

Dans l’onglet **Profil** :

1. Choisissez un nom d’affichage et, facultativement, une courte présentation. L’avatar est généré à partir des initiales et d’une couleur associée à la clé publique.
2. Le profil est privé par défaut. **Enregistrer le profil** conserve les modifications privées sur l’appareil.
3. Pour créer une page publique, activez **Publier mon profil** puis enregistrez. Le nom et la présentation sont alors envoyés au serveur et associés à la clé publique.
4. **Afficher les preuves des médias** est une option séparée, désactivée par défaut. Si elle est activée, la page présente les identifiants, empreintes, dates et signatures des médias synchronisés.
5. Utilisez **Partager ma page publique** pour partager l’adresse. Désactiver la publication et enregistrer rend la page inaccessible.

Le profil est pseudonyme : le nom d’affichage n’est pas vérifié et n’est pas nécessairement unique. Les médias restent privés sur la page tant que l’option d’affichage des preuves n’est pas activée. La base conserve les paramètres nécessaires au profil public ; quand le profil est privé, le nom et la présentation ne sont pas conservés côté serveur.

### Sauvegarder ou récupérer l’identité

Dans **Profil → Sauvegarde et récupération** :

1. Saisissez une phrase secrète d’au moins 12 caractères.
2. Choisissez **Exporter la sauvegarde chiffrée** et enregistrez le fichier partagé dans un emplacement sûr.
3. Sur un nouvel appareil, sélectionnez le fichier, saisissez la même phrase secrète, puis choisissez **Restaurer cette identité**.

Le fichier contient la clé privée Ed25519 et les paramètres du profil, chiffrés sur l’appareil avec AES-GCM et une clé dérivée par PBKDF2-SHA256. NOTOX ne reçoit ni la clé privée ni la phrase secrète. **Conservez la phrase secrète séparément du fichier** : elle ne peut pas être réinitialisée. La sauvegarde ne contient pas les images protégées ni leurs copies locales. La restauration remplace la clé de signature active ; l’application demande confirmation et les médias locaux existants restent attachés à leur clé d’origine.

## Fonctionnalités incomplètes ou indisponibles

- **Historique** : l’historique des vérifications est visible dans l’écran **Vérifier**. L’onglet séparé **Historique** affiche encore l’écran de démonstration du template.
- **Statistiques** : l’écran est un placeholder, il ne présente pas encore de statistiques.
- **Vérification réelle de textes/liens** : le flux de l’application est actuellement en mode démo.
- **C2PA, vidéo et comptes vérifiés** : non implémentés. La clé publique crée un profil pseudonyme, pas une identité humaine attestée.
- **Web** : l’écran de protection indique que la capture, la signature locale, la synchronisation et l’analyse de provenance sont réservées à l’application mobile.

## Démarrage en développement

Prérequis : Node.js, npm, et un appareil ou simulateur compatible avec Expo.

### 1. Configurer et démarrer le backend

```bash
cd back
npm install
cp .env.example .env
```

Dans `back/.env`, renseignez au minimum `GEMINI_API_KEY` pour utiliser la synchronisation et l’analyse visuelle. `PROVENANCE_DB_PATH` définit le chemin de la base SQLite ; sa valeur par défaut est `./data/notox.sqlite` depuis le répertoire `back`.

```bash
npm run dev
```

Le serveur écoute par défaut sur le port `3000`. Pour la configuration CORS du client web, indiquez les origines autorisées dans `CORS_ORIGINS`, séparées par des virgules.

### 2. (Optionnel) Démarrer le service IML-ViT

Suivez les instructions de [`back/vision/README.md`](./back/vision/README.md) pour installer le runtime Python, obtenir le code et checkpoint officiels, puis démarrer le service sur le port `8001`. Le backend utilise `IML_VIT_SERVICE_URL` (par défaut `http://127.0.0.1:8001`). Si le service est sur un autre hôte, restreignez son accès réseau et configurez le même `IML_VIT_SERVICE_TOKEN` dans les deux services.

### 3. Configurer et démarrer l’application

Dans un autre terminal :

```bash
cd front
npm install
cp .env.example .env
```

Dans `front/.env`, remplacez l’adresse d’exemple de `EXPO_PUBLIC_API_URL` par celle de votre backend. Sur un téléphone physique, utilisez l’adresse IP locale de l’ordinateur qui exécute le serveur, pas `localhost`. L’appareil et l’ordinateur doivent pouvoir communiquer sur le réseau.

```bash
npm start
```

Suivez les indications d’Expo pour ouvrir l’application sur un appareil ou un simulateur. Les fichiers `.env` peuvent contenir des secrets : ne les commitez pas.

## API de provenance

Les routes sont préfixées par `/api/provenance` :

| Méthode et route | Utilité |
|---|---|
| `POST /media` | Vérifie l’empreinte et la signature d’une image, puis enregistre ses métadonnées et son vecteur visuel. |
| `POST /localize-image` | Vérifie une image signée et renvoie la heatmap IML-ViT ; nécessite le service Python local. |
| `PUT /profile` | Enregistre des paramètres de profil signés par la clé privée locale. |
| `GET /profile/:publicKey` | Renvoie les paramètres et preuves autorisés d’un profil public. |
| `GET /p/:publicKey` | Affiche la page HTML partageable d’un profil public. |
| `POST /analyze-url` | Vérifie une requête signée par le profil et renvoie un rapport de similarité pour une page publique. |

La limite d’upload d’image est de 25 Mo ; une page analysée est limitée à 2 Mo et chaque image distante à 8 Mo. La limite de débit s’applique aux routes de provenance. Ces routes ne remplacent pas une authentification de compte et les signatures ne certifient pas la propriété légale.

Pour l’état général et les éléments encore à terminer, voir [`doc.md`](./doc.md).
