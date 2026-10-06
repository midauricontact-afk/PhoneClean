# PhoneClean 📱🧹

Web app installable (PWA) pour **libérer de la place sur son iPhone**, un peu comme TreeSize sur ordinateur.
Elle s'ouvre dans Safari, s'ajoute à l'écran d'accueil et se comporte comme une vraie app.

> Projet séparé de **MailSort** (le tri de Gmail), mais même technique et même hébergement.

## Ce qu'elle fait

| Onglet | Ce qu'on y fait |
| --- | --- |
| **Accueil** | Espace iPhone et Google utilisé, espace déjà gagné, prochaines actions triées par gain. |
| **Stockage** | Tu importes des **captures d'écran** de Réglages › Général › Stockage iPhone. Une lecture automatique (OCR, sur le téléphone) en tire chaque app avec sa taille. Carte proportionnelle façon TreeSize, liste triée, couleurs par type, correction à la main, historique et **espace gagné** entre deux captures. |
| **Nettoyage** | Checklist app par app (WhatsApp, Instagram, TikTok, Snapchat, Facebook, Messenger, Telegram, YouTube, Spotify, Netflix, Prime Video, Safari, Messages, Photos, Mail, Gmail, Google Maps, Chrome, Discord) + astuces iOS générales (apps à décharger, Messages, Supprimés récemment, données Safari, mise à jour iOS téléchargée, Podcasts, Musique hors ligne), avec la méthode exacte et le gain estimé. |
| **Photos** | Tu choisis des photos/vidéos dans le sélecteur iOS (par lots). Détection locale : **doublons exacts**, **photos similaires**, **rafales**, **photos floues**, **captures d'écran**, **grosses vidéos**. Pour chaque groupe, la meilleure est suggérée. Tu obtiens une liste claire (aperçu, date, taille) pour supprimer dans Photos. |
| **Drive** | Connexion Google. Analyse complète : carte par dossier et par type, plus gros fichiers, **doublons (MD5)**, vieux fichiers, corbeille. Mise à la **corbeille** en masse avec confirmation, vidage de la corbeille avec **double confirmation**. Quota Google total et lien vers MailSort. |
| **Réglages** | Thème, déconnexion, données, et la liste honnête de ce que l'app peut ou ne peut pas faire. |

## Ce qui est impossible sur iOS (et ce que l'app fait à la place)

PhoneClean n'affiche **jamais** de faux chiffre ni de faux bouton « Vider tous les caches ».

| Besoin | Pourquoi c'est impossible | Alternative réelle |
| --- | --- | --- |
| Lire la taille des apps de l'iPhone | iOS ne donne ces chiffres à aucune app ni site web. | **Capture d'écran + OCR** local ; tu vérifies et corriges avant d'enregistrer. |
| Vider le cache des autres apps | Chaque app est isolée. | **Guide pas à pas** par app (vider le cache dans l'app, supprimer les téléchargements, décharger, réinstaller), avec gain estimé, puis **nouvelle capture** pour mesurer le vrai gain. |
| Parcourir les fichiers du téléphone | Une web app n'y a pas accès. | Le **sélecteur iOS** pour les photos et vidéos ; Drive pour les fichiers dans le cloud. |
| Supprimer dans l'app Photos | Une web app ne peut pas modifier la photothèque. | **Liste prête à l'emploi** (aperçu, date, taille, « copier la liste ») + chemin exact dans Photos (Albums › Utilitaires › Doublons, Captures d'écran, Supprimés récemment…). Tu confirmes ensuite, et le gain est compté. |

Autres précisions honnêtes :
- Les gains « **estimés** » du nettoyage guidé sont des ordres de grandeur (part typique de la taille de l'app). Seuls les gains **mesurés** comptent dans « espace déjà gagné » : baisse entre deux captures, photos que tu confirmes avoir supprimées, corbeille Drive réellement vidée.
- La détection de photos floues/similaires est une **heuristique** : vérifie toujours l'aperçu avant de supprimer.
- Safari peut convertir les photos HEIC en JPEG à la sélection : la taille affichée peut alors différer de la taille d'origine. Dans le sélecteur, **Options** permet souvent de garder le format d'origine.
- Rien n'est envoyé à un serveur : OCR, analyse des photos et cache restent sur le téléphone. Le moteur OCR et le modèle français (environ 5 Mo) sont fournis par l'app elle-même, pas téléchargés ailleurs.

---

## Installation pas à pas

Compte environ 15 minutes. `TON-PSEUDO` est ton nom d'utilisateur GitHub (pour toi : `midauricontact-afk`).
L'app sera sur : `https://TON-PSEUDO.github.io/PhoneClean/`

### 1. Google Cloud : activer Drive et autoriser la nouvelle adresse

On réutilise le **même projet** et le **même identifiant client** que MailSort (déjà dans le fichier `.env`).

1. Ouvre <https://console.cloud.google.com/> et choisis le projet **MailSort**.
2. **API et services › Bibliothèque** › cherche **Google Drive API** › **Activer**.
3. **Google Auth Platform › Accès aux données** › **Ajouter ou supprimer des niveaux d'accès** › dans « Ajouter manuellement », colle :
   ```
   https://www.googleapis.com/auth/drive
   ```
   › **Ajouter au tableau** › **Mettre à jour** › **Enregistrer**.
4. **Google Auth Platform › Clients** › ouvre ton client **MailSort** › dans **URI de redirection autorisés**, ajoute :
   `https://TON-PSEUDO.github.io/PhoneClean/` (avec le `/` final) › **Enregistrer**.
   *(L'origine JavaScript `https://TON-PSEUDO.github.io` est déjà là : c'est le même site que MailSort.)*
5. **Audience** : laisse « En test » et vérifie que ton adresse est dans les utilisateurs test.

> Sans cette étape, tout marche sauf l'onglet Drive (le mode démo reste disponible).

### 2. Mettre l'app en ligne (GitHub Pages, gratuit)

1. Sur GitHub : **+ › New repository** › nom **`PhoneClean`** › **Public** › ne coche rien d'autre › **Create repository**.
2. Envoie le code (commandes à lancer dans le dossier du projet) :
   ```bash
   git remote add origin https://github.com/TON-PSEUDO/PhoneClean.git
   ```
   ```bash
   git push -u origin main
   ```
3. Dans le dépôt : **Settings › Pages › Source : GitHub Actions**.
4. Onglet **Actions** : si le premier déploiement a échoué (Pages n'était pas encore activé), ouvre-le et touche **Re-run all jobs**. Après 1 à 2 minutes : coche verte.

Chaque `git push` republie l'app (les tests doivent passer).

### 3. Installer sur l'iPhone

1. Ouvre **Safari** et va sur `https://TON-PSEUDO.github.io/PhoneClean/`.
2. **Partager** (carré avec une flèche) › **Sur l'écran d'accueil** › **Ajouter**.
3. Ouvre PhoneClean depuis l'icône : plein écran, comme une vraie app.

### 4. Ta première capture du stockage

1. **Réglages › Général › Stockage iPhone** : attends que la liste se remplisse.
2. Capture d'écran (**bouton latéral + volume haut**). Fais défiler, recapture, jusqu'en bas.
3. Dans PhoneClean : **Stockage › Importer mes captures** › choisis **toutes** les captures d'un coup.
4. Vérifie les valeurs lues (corrige si besoin) › **Enregistrer**.
5. Fais ton nettoyage (onglet **Nettoyage**), puis **refais une capture** : l'app affiche l'espace gagné.

### 5. Google Drive

Onglet **Drive › Se connecter avec Google**. Google affiche « Google n'a pas validé cette application » (normal, ton app est en mode test) : **Continuer**, puis coche l'accès à Drive.
Pour essayer sans compte : **Essayer avec un faux Drive de démonstration**.

---

## Pour les développeurs

```bash
npm install
```
```bash
npm run dev
```
```bash
npm test
```
```bash
npm run build
```

- Vite + React 19 + TypeScript. `npm run ocr:copy` (lancé par `dev` et `build`) copie Tesseract et le modèle français dans `public/ocr/` (ignoré par git).
- `src/core/` : logique pure et testée — `ocrParse` (lecture des captures), `treemap` (carte), `snapshots` (historique, gains), `guides` (nettoyage guidé), `imageAnalysis` (doublons, similaires, flou, captures), `driveAnalysis` (arborescence, doublons MD5), `actions` (prochaines actions).
- `src/ocr/` : OCR local (Tesseract.js). `src/photos/` : décodage et empreintes sur le téléphone. `src/drive/` : API Drive + faux Drive de démo. `src/auth/` : Google Identity Services (jeton 1 h, renouvellement silencieux).
- `src/state/` : stores (app, photos, drive). `src/storage/` : IndexedDB.
- `public/sw.js` : service worker (interface + moteur OCR, jamais tes données).
- `npm run icons` régénère les icônes.
