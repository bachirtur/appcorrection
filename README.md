# EduExam — Plateforme universelle d’évaluation scolaire en ligne

**EduExam** est une application web complète, sécurisée et responsive d’évaluation scolaire multi-matières et multi-niveaux (Primaire, Collège, Lycée, Enseignement supérieur, Formation professionnelle), pré-configurée pour votre projet Firebase **`appcorrection`** et prête à être déployée gratuitement sur **GitHub Pages**.

---

## 1. Fonctionnalités clés implémentées

### Espace Professeur (privé et strictement isolé)
- **Authentification sécurisée** : création de compte professionnel, validation de l’adresse e-mail, connexion/déconnexion, réinitialisation du mot de passe, protection anti-force brute, et ré-authentification lors des opérations sensibles (suppression d’examen, changement de mot de passe).
- **Tableau de bord en temps réel** : nombre total d’examens, examens publiés, examens en cours, examens terminés, nombre de copies reçues, moyenne sur 20 par examen, taux de réussite et dernières soumissions.
- **Assistant de création d’examen en 5 étapes** :
  1. *Informations générales* : matière, niveau, classe, durée, dates d’ouverture/clôture, barème maximal (défaut 20), langue, tentatives autorisées, modification avant soumission, restitution ou non de la note et des réponses attendues.
  2. *Importation privée du sujet PDF* : glisser-déposer, vérification binaire `%PDF-`, limite de taille configurable, barre de progression réelle, lecteur PDF intégré (zoom, pages, recherche, plein écran), stockage privé sans URL publique permanente.
  3. *Importation confidentielle de la correction PDF & Questions* : corrigé stocké dans un espace strictement confidentiel (jamais accessible au navigateur élève) + éditeur des **10 types de questions** (QCM unique/multiple, Vrai/Faux, Numérique avec tolérance et unité, Texte court, Texte long/rédaction, Formule mathématique KaTeX, Code informatique Python/JS/SQL/C/Pseudo-code, Tableau à compléter, Réponse structurée, Pièce jointe/schéma).
  4. *Configuration du barème* :
     - **Mode A (Automatique)** : réservé aux questions objectives définies avec précision.
     - **Mode B (Assisté)** : grille de critères et points partiels + pré-évaluation algorithmique optionnelle explicitement marquée comme *indicative* avec validation humaine obligatoire.
     - **Mode C (Manuel)** : attribution directe des points par l’enseignant.
  5. *Publication & Code d’accès* : génération côté serveur (CSPRNG) d’un identifiant unique (`EXM-AAAA-XXXXXX`) et d’un mot de passe d’examen stocké sous forme d’empreinte salée `scrypt`.
- **Gestion des copies, correction, audit et rapports** :
  - Filtres multicritères (classe, matière, examen, date, note min/max, état de correction).
  - Correction côte-à-côte avec aperçu du corrigé PDF confidentiel.
  - **Journal d’audit immuable** : toute modification d’une note déjà validée exige un motif obligatoire tracé et horodaté.
  - Génération de **PDF A** (rapport confidentiel détaillé professeur incluant les événements d’intégrité et l’audit), **PDF B** (relevé élève filtré selon vos paramètres de restitution), **Bilan PDF de classe** et **Export CSV (UTF-8 BOM Excel)**.
  - Notification automatique par e-mail transactionnel à chaque copie soumise + bouton de relance.

### Espace Élève (public mais contrôlé côté serveur)
- **Accès dédié sans exposition d’informations confidentielles** : identification par nom, prénom, classe, identifiant d’examen et mot de passe d’examen.
- **Consultation et téléchargement autorisé du sujet PDF** via jeton temporaire signé limité dans le temps.
- **Interface de travail en deux colonnes** (adaptative par onglets sur smartphone) : lecteur PDF complet à gauche + feuille de réponses interactive à droite.
- **Chronomètre contrôlé côté serveur** : l’heure de démarrage et l’échéance sont scellées sur le serveur (recharger la page ou modifier l’horloge de l’ordinateur ne prolonge jamais le temps).
- **Sauvegarde automatique périodique** sur le serveur + sauvegarde locale de secours hors ligne + soumission automatique à l’expiration du temps + verrouillage anti-double soumission.
- **Suivi proportionné de l’intégrité** : détection transparente des changements d’onglet, pertes de focus et sorties du plein écran, signalés à titre contextuel (et non comme preuve automatique de fraude).

---

## 2. Structure du dépôt

```text
appcorrection/
├── .github/workflows/deploy-pages.yml  # Déploiement automatisé GitHub Pages (CI + Tests)
├── .firebaserc                         # Pré-configuré sur votre projet Firebase "appcorrection"
├── firebase.json                       # Configuration Firestore, Storage, Functions & Emulators
├── firestore.rules                     # Règles de sécurité Firestore restrictives par défaut
├── storage.rules                       # Règles Cloud Storage privées (sujets & corrigés isolés)
├── firestore.indexes.json              # Index composites Firestore
├── .env.example                        # Modèle de configuration publique (aucun secret)
├── index.html
├── package.json
├── vite.config.ts
├── src/
│   ├── main.tsx & App.tsx
│   ├── types/index.ts                  # Modèles TypeScript complets
│   ├── context/                        # AuthContext & ThemeContext (clair/sombre)
│   ├── components/                     # PdfViewer, QuestionInput, QuestionBuilder, Code, KaTeX...
│   ├── pages/                          # Home, TeacherLogin, TeacherDashboard, ExamEditor,
│   │                                   # StudentAccess, ExamWorkspace, Submissions, Results...
│   └── services/                       # firebase.ts, auth.ts, exams.ts, submissions.ts,
│                                       # grading.ts, pdf.ts
├── functions/                          # Cloud Functions Firebase v2 (TypeScript, europe-west1)
│   ├── package.json
│   └── src/                            # index.ts, gradingEngine.ts, cryptoUtils.ts, mailer.ts
├── server/                             # Serveur API Node/Express sécurisé (développement local,
│                                       # aperçu direct ou auto-hébergement gratuit alternatif)
└── tests/                              # Suite automatisée Vitest & Supertest (18 scénarios)
```

---

## 3. Quotas gratuits et vérification transparente des coûts (Important)

Avant mise en production, voici l’état exact et vérifié des offres gratuites :

| Service | Quota gratuit inclus | Point d’attention important |
| :--- | :--- | :--- |
| **GitHub Pages** | Hébergement statique gratuit illimité pour dépôts publics (100 Go bande passante/mois) | Aucun frais ni carte bancaire requise. |
| **Firebase Authentication** | **50 000 utilisateurs actifs / mois** gratuits (forfaits Spark et Blaze) | 100 % gratuit pour un usage scolaire ou d’établissement. |
| **Cloud Firestore** | **1 Gio stocké**, 50 000 lectures/jour, 20 000 écritures/jour, 20 000 suppressions/jour gratuits | Suffisant pour plusieurs centaines d’élèves par jour. |
| **Cloud Functions & Cloud Storage** | **2 millions d’appels/mois** gratuits (Functions) + **5 Go** gratuits sur région éligible | **Attention :** Google exige l’activation du mode **Blaze (paiement à l’usage avec alerte budget à 0 € / 1 €)** sur le projet Firebase pour déployer `functions` et `storage`. Tant que vous restez sous les quotas ci-dessus, la facture mensuelle reste de **0,00 €**. |
| **Alternative 0 carte bancaire (Serveur API inclus)** | Le dossier `server/` fournit le même backend sécurisé en Node.js/Express | Peut être exécuté gratuitement en local, sur un serveur d’établissement ou sur une instance Node gratuite si vous ne souhaitez pas activer le plan Blaze sur Firebase. |
| **E-mails transactionnels** | **Resend** : 3 000 e-mails/mois gratuits (100/jour) • **Brevo** : 300 e-mails/jour gratuits | Clé API à stocker **exclusivement** dans les secrets serveur, jamais dans le frontend. |

---

## 4. Procédure de liaison avec votre projet Firebase `appcorrection`

Le fichier `.firebaserc` pointe déjà directement vers votre projet **`appcorrection`**. Aucune intervention n’a été simulée sur votre compte personnel : suivez ces étapes exactes pour activer la liaison avec votre console Firebase.

### Étape 1 — Activer les services dans la Console Firebase
1. Ouvrez [https://console.firebase.google.com/](https://console.firebase.google.com/) et sélectionnez votre projet **`appcorrection`**.
2. **Authentication** : cliquez sur *Créer / Commencer* → onglet *Méthode de connexion* → activez **Adresse e-mail / Mot de passe**. Dans *Paramètres > Domaines autorisés*, ajoutez `bachirtur.github.io`.
3. **Firestore Database** : cliquez sur *Créer une base de données* → choisissez la région `eur3 (europe-west)` → démarrez en **mode production**.
4. **Storage** : cliquez sur *Commencer* en **mode production** (si Firebase demande le passage au forfait Blaze, configurez une alerte budgétaire à 1 € dans Google Cloud Billing).
5. **Application Web** : dans *Paramètres du projet (roue dentée) > Général > Vos applications*, cliquez sur l’icône Web `</>` pour enregistrer l’application `EduExam` et copiez les valeurs `apiKey`, `messagingSenderId` et `appId`.

### Étape 2 — Configurer les variables secrètes côté serveur (Cloud Functions)
Installez Firebase CLI sur votre poste si nécessaire (`npm install -g firebase-tools`), puis à la racine du dépôt :

```bash
firebase login
firebase use appcorrection

# Générer et enregistrer le secret HMAC de signature des sessions élèves
firebase functions:secrets:set SESSION_HMAC_SECRET

# Enregistrer la clé API de votre service d'e-mail transactionnel (ex: Resend)
firebase functions:secrets:set RESEND_API_KEY
```

> **Règle de sécurité absolue :** ces secrets résident dans *Google Cloud Secret Manager*. Ne les copiez **jamais** dans `.env` ni dans GitHub.

### Étape 3 — Déployer les règles de sécurité et les Cloud Functions
```bash
npm --prefix functions install
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

---

## 5. Procédure de déploiement automatisé sur GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` compile, exécute les tests de sécurité et déploie automatiquement l’interface sur GitHub Pages à chaque `push` sur `main`.

1. Sur GitHub, ouvrez le dépôt **`bachirtur/appcorrection`** → **Settings** → **Pages**.
2. Sous *Build and deployment > Source*, sélectionnez **GitHub Actions**.
3. Allez dans **Settings** → **Secrets and variables** → **Actions** → onglet **Variables** (variables publiques de build client uniquement) et créez :
   - `VITE_BACKEND_MODE` = `firebase`
   - `VITE_FIREBASE_API_KEY` = *(votre apiKey Web Firebase publique)*
   - `VITE_FIREBASE_AUTH_DOMAIN` = `appcorrection.firebaseapp.com`
   - `VITE_FIREBASE_PROJECT_ID` = `appcorrection`
   - `VITE_FIREBASE_STORAGE_BUCKET` = `appcorrection.firebasestorage.app`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID` = *(votre messagingSenderId)*
   - `VITE_FIREBASE_APP_ID` = *(votre appId)*
   - `VITE_FIREBASE_FUNCTIONS_REGION` = `europe-west1`
4. Déclenchez le workflow depuis l’onglet **Actions** (*Déploiement EduExam sur GitHub Pages* → *Run workflow*) ou fusionnez vers `main`.
5. Votre plateforme est accessible sur : `https://bachirtur.github.io/appcorrection/`

---

## 6. Développement local et exécution immédiate

```bash
# 1. Installer les dépendances
npm install

# 2. Copier le fichier d'exemple d'environnement (optionnel en local : bascule auto sur le serveur API)
cp .env.example .env

# 3. Démarrer simultanément le serveur sécurisé (port 3001) et l'interface Vite (port 5173)
npm run dev

# 4. Exécuter l'ensemble des tests unitaires, d'intégration et de sécurité
npm test
```

---

## 7. Création du premier compte professeur

1. Ouvrez l’application et cliquez sur **« Espace professeur »** puis sur l’onglet **« Créer un compte »**.
2. Renseignez vos nom, prénom, adresse e-mail professionnelle et un mot de passe robuste (minimum 8 caractères avec majuscule, minuscule et chiffre).
3. Consultez et acceptez les conditions d’utilisation et la politique de confidentialité RGPD, puis validez.
4. **Validez votre adresse e-mail** (via le lien reçu par e-mail avec Firebase Auth, ou via le bandeau de vérification en mode local) afin d’activer l’envoi des notifications de copies à votre adresse vérifiée.

---

## 8. Checklist de vérification avant la première utilisation réelle en classe

- [ ] Aucun fichier `.env`, clé privée `.json` ou corrigé réel ne figure dans `git status` (`npm test` vérifie automatiquement l’absence de secrets).
- [ ] Les règles `firestore.rules` et `storage.rules` ont été déployées sur le projet `appcorrection`.
- [ ] Votre adresse e-mail professeur affiche le badge vert **« E-mail vérifié »** dans la barre latérale.
- [ ] Le sujet PDF s’affiche nettement dans l’aperçu (Étape 2) et le corrigé PDF est bien importé séparément (Étape 3).
- [ ] Le barème total et les modes de correction (Mode A / Mode B / Mode C) ont été relus à l’Étape 4.
- [ ] Vous avez testé l’examen via le bouton **« Prévisualiser l’examen »** ET effectué un essai élève complet avec le code d’accès généré à l’Étape 5.
- [ ] Vous avez vérifié la réception de la copie dans **« Copies des élèves »** ainsi que le téléchargement des rapports **PDF A** et **PDF B**.
