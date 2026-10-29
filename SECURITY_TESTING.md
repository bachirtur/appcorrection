# Procédure de test de sécurité et de contrôle des règles d’accès — EduExam

Ce document décrit les procédures permettant de vérifier formellement l’isolation des données, la confidentialité des corrigés, la résistance aux manipulations côté client et les règles Firebase (`firestore.rules` et `storage.rules`).

---

## 1. Exécution de la suite automatisée (18 scénarios obligatoires)

À la racine du dépôt, exécutez :

```bash
npm test
```

Cette commande vérifie automatiquement :
1. **Inscription, validation d’e-mail et hachage `scrypt`** : absence totale de mot de passe ou de sel dans les réponses JSON.
2. **Validation binaire des PDF (`%PDF-`)** : rejet immédiat de tout fichier déguisé en `.pdf` ne possédant pas l’en-tête binaire valide.
3. **Isolation stricte inter-professeurs (`HTTP 403`)** : un professeur authentifié B ne peut ni lire, ni modifier, ni télécharger le sujet ou la correction d’un examen créé par le professeur A, ni consulter ses copies.
4. **Confidentialité absolue du corrigé pendant l’épreuve** :
   - Les réponses attendues (`rubrics`) sont extraites côté serveur et stockées dans `examSecrets` ; elles ne sont jamais envoyées au navigateur de l’élève lors de `/access` ni de `/start`.
   - Tout appel élève vers une ressource de correction renvoie `401` ou `403`.
5. **Jeton temporaire signé pour le sujet PDF** : l’élève reçoit uniquement une autorisation temporaire limitée au sujet (`scope = subject:<examId>`), sans exposition du chemin de stockage privé.
6. **Immuabilité du chronomètre serveur** : rappeler `/start` ou recharger la page conserve exactement la même échéance `deadlineAt` enregistrée côté serveur.
7. **Idempotence et résistance aux doubles soumissions** : soumettre deux fois la même session ne crée qu’une seule copie verrouillée (`locked: true`) et bloque toute tentative supplémentaire au-delà de `maxAttempts`.
8. **Traçabilité d’audit obligatoire** : toute tentative de modifier la note d’une copie déjà validée sans renseigner de motif (`auditReason`) est rejetée (`HTTP 400`) ; lorsqu’un motif est fourni, l’ancienne note, la nouvelle note et l’horodatage sont inscrits dans `auditLogs`.
9. **Audit statique du code source** : absence de clés privées, de comptes de service Firebase Admin ou de clés API d’e-mail dans le code versionné.

---

## 2. Test local des règles Firestore et Cloud Storage avec Firebase Emulator Suite

Sur votre poste disposant de Java 17+ et de `firebase-tools` :

```bash
# Démarrer les émulateurs locaux (Auth: 9099, Functions: 5001, Firestore: 8080, Storage: 9199, UI: 4000)
firebase emulators:start
```

Ouvrez ensuite l’interface **Rules Playground** dans `http://localhost:4000/firestore` et vérifiez les 5 assertions suivantes :

| Test | Type d’opération | Chemin testé | Authentification simulée | Résultat attendu |
| :--- | :--- | :--- | :--- | :--- |
| **T1 — Élève non authentifié lisant les examens** | `get` | `/exams/exam_123` | *Non authentifié* | **REFUSÉ (Deny)** |
| **T2 — Élève lisant les secrets / barème** | `get` | `/examSecrets/exam_123` | *Non authentifié* | **REFUSÉ (Deny)** |
| **T3 — Professeur B lisant un examen du Professeur A** | `get` | `/exams/exam_123` (`teacherId: "uid_A"`) | `auth.uid = "uid_B"` | **REFUSÉ (Deny)** |
| **T4 — Tentative client d’écrire dans `auditLogs`** | `create` | `/auditLogs/log_1` | `auth.uid = "uid_A"` | **REFUSÉ (Deny)** |
| **T5 — Professeur A lisant son propre examen** | `get` | `/exams/exam_123` (`teacherId: "uid_A"`) | `auth.uid = "uid_A"` | **AUTORISÉ (Allow)** |

De même, dans l’onglet **Storage Rules** (`http://localhost:4000/storage`) :
- Lecture non authentifiée de `/exams/uid_A/exam_123/confidential_correction/correction.pdf` → **REFUSÉ**.
- Lecture par `uid_B` de `/exams/uid_A/exam_123/private_subject/subject.pdf` → **REFUSÉ**.
- Téléversement par `uid_A` d’un fichier dont `contentType != 'application/pdf'` ou `size > 25 MB` → **REFUSÉ**.
