import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import {
  createSessionToken,
  generateExamPublicId,
  generateSecureReadableCode,
  hashSecretCode,
  verifySecretCode,
  verifySessionToken,
} from './cryptoUtils';
import { computeAppreciation, evaluateSubmissionOnServer, round2, QuestionGrade } from './gradingEngine';
import { sendSubmissionEmailToTeacher } from './mailer';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// Secrets stockés exclusivement dans Google Secret Manager (JAMAIS dans le code ni .env public)
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const SESSION_HMAC_SECRET = defineSecret('SESSION_HMAC_SECRET');

const REGION = 'europe-west1';

function getHmacSecret(): string {
  return SESSION_HMAC_SECRET.value() || process.env.SESSION_HMAC_SECRET || 'eduexam-fallback-dev-only-change-in-prod';
}

function studentFingerprint(firstName: string, lastName: string, className: string, email?: string): string {
  const raw = [
    (lastName || '').trim().toLowerCase(),
    (firstName || '').trim().toLowerCase(),
    (className || '').trim().toLowerCase(),
    (email || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

// ============================================================================
// 1. Publication d'un examen & génération cryptographique du code d'accès
// ============================================================================
export const publishExamWithAccessCode = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification professeur requise.');
    }
    const uid = request.auth.uid;
    const { examId, regenerateCode } = request.data as { examId?: string; regenerateCode?: boolean };
    if (!examId) {
      throw new HttpsError('invalid-argument', 'Identifiant d’examen manquant.');
    }

    const examRef = db.collection('exams').doc(examId);
    const examSnap = await examRef.get();
    if (!examSnap.exists) {
      throw new HttpsError('not-found', 'Examen introuvable.');
    }
    const exam = examSnap.data()!;
    if (exam.teacherId !== uid) {
      throw new HttpsError('permission-denied', 'Accès refusé à cet examen.');
    }

    const secretRef = db.collection('examSecrets').doc(examId);
    const secretSnap = await secretRef.get();
    const secretData = secretSnap.exists ? secretSnap.data()! : {};

    const examCode = exam.examCode || generateExamPublicId();
    let plainAccessCode: string | null = null;
    let hashPayload = {
      accessCodeHash: secretData.accessCodeHash || '',
      accessCodeSalt: secretData.accessCodeSalt || '',
      accessCodePreviewHint: secretData.accessCodePreviewHint || '',
    };

    if (!hashPayload.accessCodeHash || regenerateCode) {
      plainAccessCode = generateSecureReadableCode(3, 4);
      const hashed = hashSecretCode(plainAccessCode);
      hashPayload = {
        accessCodeHash: hashed.hash,
        accessCodeSalt: hashed.salt,
        accessCodePreviewHint: `${plainAccessCode.slice(0, 4)}-****-${plainAccessCode.slice(-2)}`,
      };
    }

    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      tx.set(
        secretRef,
        {
          teacherId: uid,
          examId,
          ...hashPayload,
          updatedAt: nowIso,
        },
        { merge: true }
      );
      tx.update(examRef, {
        examCode,
        status: 'published',
        publishedAt: exam.publishedAt || nowIso,
        expiresAt: exam.endAt,
        updatedAt: nowIso,
      });
    });

    return {
      examId,
      examCode,
      accessCode: plainAccessCode, // Retourné une seule fois au professeur lors de la génération
      accessCodePreviewHint: hashPayload.accessCodePreviewHint,
      status: 'published',
    };
  }
);

// ============================================================================
// 2. Vérification d'accès élève (anti-bruteforce, période, tentatives)
// ============================================================================
export const verifyStudentExamAccess = onCall(
  { region: REGION, secrets: [SESSION_HMAC_SECRET] },
  async (request) => {
    const {
      firstName,
      lastName,
      email,
      className,
      examCode,
      accessCode,
    } = (request.data || {}) as Record<string, string>;

    if (!firstName?.trim() || !lastName?.trim() || !className?.trim() || !examCode?.trim() || !accessCode?.trim()) {
      throw new HttpsError('invalid-argument', 'Veuillez renseigner tous les champs obligatoires.');
    }

    const normalizedExamCode = examCode.trim().toUpperCase();
    const examsQuery = await db
      .collection('exams')
      .where('examCode', '==', normalizedExamCode)
      .limit(1)
      .get();

    // Message volontairement neutre pour ne pas révéler d'informations confidentielles
    const genericDeniedMsg =
      'Identifiant d’examen ou mot de passe invalide, ou évaluation actuellement fermée.';

    if (examsQuery.empty) {
      throw new HttpsError('permission-denied', genericDeniedMsg);
    }

    const examDoc = examsQuery.docs[0];
    const exam = examDoc.data();
    const examId = examDoc.id;

    if (exam.status !== 'published') {
      throw new HttpsError('permission-denied', genericDeniedMsg);
    }

    const now = Date.now();
    const startMs = Date.parse(exam.startAt);
    const endMs = Date.parse(exam.endAt);
    if ((Number.isFinite(startMs) && now < startMs) || (Number.isFinite(endMs) && now > endMs)) {
      throw new HttpsError(
        'failed-precondition',
        'Cette évaluation n’est pas ouverte à cette date ou est arrivée à expiration.'
      );
    }

    if (exam.requireStudentEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new HttpsError('invalid-argument', 'Une adresse e-mail valide est requise pour cette évaluation.');
    }

    const secretSnap = await db.collection('examSecrets').doc(examId).get();
    if (!secretSnap.exists) {
      throw new HttpsError('permission-denied', genericDeniedMsg);
    }
    const secret = secretSnap.data()!;
    const codeValid = verifySecretCode(accessCode, secret.accessCodeHash, secret.accessCodeSalt);
    if (!codeValid) {
      throw new HttpsError('permission-denied', genericDeniedMsg);
    }

    const fp = studentFingerprint(firstName, lastName, className, email);
    const existingSessionsSnap = await db
      .collection('examSessions')
      .where('examId', '==', examId)
      .where('studentFingerprint', '==', fp)
      .get();

    let activeSessionDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let submittedCount = 0;

    existingSessionsSnap.forEach((docSnap) => {
      const s = docSnap.data();
      if (s.status === 'submitted') {
        submittedCount += 1;
      } else if (s.status === 'in_progress' || s.status === 'authorized_waiting') {
        activeSessionDoc = docSnap;
      }
    });

    const maxAttempts = Number(exam.maxAttempts || 1);
    if (!activeSessionDoc && submittedCount >= maxAttempts) {
      throw new HttpsError(
        'resource-exhausted',
        `Vous avez déjà utilisé le nombre maximal de tentatives autorisées (${maxAttempts}) pour cet examen.`
      );
    }

    let sessionId: string;
    let sessionData: Record<string, any>;

    if (activeSessionDoc) {
      sessionId = (activeSessionDoc as FirebaseFirestore.QueryDocumentSnapshot).id;
      sessionData = (activeSessionDoc as FirebaseFirestore.QueryDocumentSnapshot).data();
    } else {
      const sessionRef = db.collection('examSessions').doc();
      sessionId = sessionRef.id;
      const nowIso = new Date(now).toISOString();
      sessionData = {
        examId,
        examCode: exam.examCode,
        teacherId: exam.teacherId,
        studentFingerprint: fp,
        student: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email?.trim() || '',
          className: className.trim(),
        },
        attemptNumber: submittedCount + 1,
        status: 'authorized_waiting',
        revision: 0,
        savedAnswers: {},
        integrityEvents: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await sessionRef.set(sessionData);
    }

    const tokenExp = now + Math.max(exam.durationMinutes * 60 * 1000, 4 * 3600 * 1000);
    const sessionToken = createSessionToken(sessionId, getHmacSecret(), tokenExp);

    const deadlineMs = sessionData.deadlineAt
      ? Date.parse(sessionData.deadlineAt)
      : Math.min(now + exam.durationMinutes * 60 * 1000, Number.isFinite(endMs) ? endMs : Infinity);

    return {
      sessionId,
      sessionToken,
      examId,
      examCode: exam.examCode,
      title: exam.title,
      subject: exam.subject,
      level: exam.level,
      className: exam.className,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      maxScore: exam.maxScore,
      language: exam.language,
      allowModifyBeforeSubmit: Boolean(exam.allowModifyBeforeSubmit),
      allowSubjectDownload: Boolean(exam.allowSubjectDownload),
      autoSaveIntervalSeconds: Number(exam.autoSaveIntervalSeconds || 20),
      enableIntegrityMonitoring: Boolean(exam.enableIntegrityMonitoring),
      hasSubjectPdf: Boolean(exam.hasSubjectPdf),
      subjectFileName: exam.subjectFileName || 'Sujet_Examen.pdf',
      questionCount: Array.isArray(exam.questions) ? exam.questions.length : 0,
      questions: sessionData.status === 'in_progress' ? exam.questions || [] : [],
      student: sessionData.student,
      attemptNumber: sessionData.attemptNumber,
      status: sessionData.status,
      startedAt: sessionData.startedAt || null,
      deadlineAt: sessionData.deadlineAt || null,
      serverNow: new Date(now).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - now) / 1000)),
      revision: sessionData.revision || 0,
      savedAnswers: sessionData.savedAnswers || {},
      integrityEvents: sessionData.integrityEvents || [],
    };
  }
);

// ============================================================================
// 3. Démarrage officiel de l'épreuve (enregistrement heure serveur immuable)
// ============================================================================
export const startExamSession = onCall(
  { region: REGION, secrets: [SESSION_HMAC_SECRET] },
  async (request) => {
    const { sessionId, sessionToken } = (request.data || {}) as { sessionId?: string; sessionToken?: string };
    if (!sessionId || !sessionToken || !verifySessionToken(sessionToken, sessionId, getHmacSecret())) {
      throw new HttpsError('unauthenticated', 'Session d’examen invalide ou expirée.');
    }

    const sessionRef = db.collection('examSessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session introuvable.');
    }
    const session = sessionSnap.data()!;
    if (session.status === 'submitted') {
      throw new HttpsError('failed-precondition', 'Cette copie a déjà été soumise définitivement.');
    }

    const examSnap = await db.collection('exams').doc(session.examId).get();
    if (!examSnap.exists) {
      throw new HttpsError('not-found', 'Examen introuvable.');
    }
    const exam = examSnap.data()!;
    const now = Date.now();
    const endMs = Date.parse(exam.endAt);

    let startedAtIso = session.startedAt;
    let deadlineAtIso = session.deadlineAt;

    if (!startedAtIso) {
      startedAtIso = new Date(now).toISOString();
      const computedEnd = Math.min(
        now + Number(exam.durationMinutes) * 60 * 1000,
        Number.isFinite(endMs) ? endMs : now + Number(exam.durationMinutes) * 60 * 1000
      );
      deadlineAtIso = new Date(computedEnd).toISOString();
      await sessionRef.update({
        status: 'in_progress',
        startedAt: startedAtIso,
        deadlineAt: deadlineAtIso,
        updatedAt: startedAtIso,
      });
    }

    const remainingSeconds = Math.max(0, Math.floor((Date.parse(deadlineAtIso) - now) / 1000));

    return {
      status: 'in_progress',
      startedAt: startedAtIso,
      deadlineAt: deadlineAtIso,
      serverNow: new Date(now).toISOString(),
      remainingSeconds,
      questions: exam.questions || [],
    };
  }
);

// ============================================================================
// 4. Obtention d'une URL temporaire signée pour le SUJET PDF (jamais le corrigé)
// ============================================================================
export const getSubjectPdfUrl = onCall(
  { region: REGION, secrets: [SESSION_HMAC_SECRET] },
  async (request) => {
    const { sessionId, sessionToken } = (request.data || {}) as { sessionId?: string; sessionToken?: string };
    if (!sessionId || !sessionToken || !verifySessionToken(sessionToken, sessionId, getHmacSecret())) {
      throw new HttpsError('unauthenticated', 'Session non autorisée.');
    }

    const sessionSnap = await db.collection('examSessions').doc(sessionId).get();
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session introuvable.');
    }
    const session = sessionSnap.data()!;
    const examSnap = await db.collection('exams').doc(session.examId).get();
    if (!examSnap.exists || !examSnap.data()!.hasSubjectPdf) {
      throw new HttpsError('not-found', 'Aucun sujet PDF disponible pour cet examen.');
    }
    const exam = examSnap.data()!;
    const storagePath = `exams/${exam.teacherId}/${session.examId}/private_subject/subject.pdf`;
    const file = storage.bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'Fichier sujet introuvable dans le stockage sécurisé.');
    }

    // URL signée temporaire limitée à 30 minutes — n'expose aucun chemin permanent
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 30 * 60 * 1000,
    });

    return {
      temporaryUrl: signedUrl,
      fileName: exam.subjectFileName || 'Sujet_Examen.pdf',
      allowDownload: Boolean(exam.allowSubjectDownload),
    };
  }
);

// ============================================================================
// 5. Sauvegarde automatique périodique avec contrôle de révision et d'horloge
// ============================================================================
export const saveDraftAnswers = onCall(
  { region: REGION, secrets: [SESSION_HMAC_SECRET] },
  async (request) => {
    const { sessionId, sessionToken, answers, clientRevision, integrityEvents } = (request.data || {}) as {
      sessionId?: string;
      sessionToken?: string;
      answers?: Record<string, any>;
      clientRevision?: number;
      integrityEvents?: any[];
    };

    if (!sessionId || !sessionToken || !verifySessionToken(sessionToken, sessionId, getHmacSecret())) {
      throw new HttpsError('unauthenticated', 'Session invalide.');
    }

    const sessionRef = db.collection('examSessions').doc(sessionId);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Session introuvable.');
      }
      const data = snap.data()!;
      if (data.status === 'submitted') {
        throw new HttpsError('failed-precondition', 'Copie déjà soumise et verrouillée.');
      }

      const deadlineMs = data.deadlineAt ? Date.parse(data.deadlineAt) : Infinity;
      const remainingSeconds = Math.max(0, Math.floor((deadlineMs - now) / 1000));

      const currentRev = Number(data.revision || 0);
      const nextRev = currentRev + 1;

      tx.update(sessionRef, {
        savedAnswers: answers || data.savedAnswers || {},
        integrityEvents: Array.isArray(integrityEvents) ? integrityEvents.slice(0, 200) : data.integrityEvents || [],
        revision: nextRev,
        lastSavedAt: nowIso,
        updatedAt: nowIso,
      });

      return {
        savedAt: nowIso,
        serverNow: nowIso,
        remainingSeconds,
        revision: nextRev,
        conflictDetected: clientRevision !== undefined && clientRevision < currentRev,
      };
    });
  }
);

// ============================================================================
// 6. Soumission définitive atomique, notation serveur et notification e-mail
// ============================================================================
export const submitExamCopy = onCall(
  { region: REGION, secrets: [SESSION_HMAC_SECRET, RESEND_API_KEY] },
  async (request) => {
    const {
      sessionId,
      sessionToken,
      answers,
      integrityEvents,
      autoSubmitted,
      appOriginUrl,
    } = (request.data || {}) as {
      sessionId?: string;
      sessionToken?: string;
      answers?: Record<string, any>;
      integrityEvents?: any[];
      autoSubmitted?: boolean;
      appOriginUrl?: string;
    };

    if (!sessionId || !sessionToken || !verifySessionToken(sessionToken, sessionId, getHmacSecret())) {
      throw new HttpsError('unauthenticated', 'Session invalide.');
    }

    const sessionRef = db.collection('examSessions').doc(sessionId);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const txResult = await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(sessionRef);
      if (!sSnap.exists) {
        throw new HttpsError('not-found', 'Session introuvable.');
      }
      const session = sSnap.data()!;

      // Idempotence : empêche toute double soumission
      if (session.status === 'submitted' && session.submissionId) {
        const existingSub = await tx.get(db.collection('submissions').doc(session.submissionId));
        return { alreadySubmitted: true, submission: existingSub.data()!, submissionId: session.submissionId };
      }

      const examSnap = await tx.get(db.collection('exams').doc(session.examId));
      const secretSnap = await tx.get(db.collection('examSecrets').doc(session.examId));
      const teacherSnap = await tx.get(db.collection('teachers').doc(session.teacherId));

      if (!examSnap.exists) {
        throw new HttpsError('not-found', 'Examen introuvable.');
      }
      const exam = examSnap.data()!;
      const secret = secretSnap.exists ? secretSnap.data()! : {};
      const teacher = teacherSnap.exists ? teacherSnap.data()! : null;

      // Tolérance réseau de 45 secondes pour la soumission automatique à expiration
      const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : now;
      const finalAnswers =
        now <= deadlineMs + 45_000 ? answers || session.savedAnswers || {} : session.savedAnswers || {};

      const evalSummary = evaluateSubmissionOnServer(
        exam.questions || [],
        secret.rubrics || {},
        finalAnswers,
        Number(exam.maxScore || 20)
      );

      const startedMs = session.startedAt ? Date.parse(session.startedAt) : now;
      const durationSeconds = Math.max(1, Math.round((Math.min(now, deadlineMs + 5000) - startedMs) / 1000));

      const submissionId = `SUB-${new Date().getUTCFullYear()}-${generateSecureReadableCode(1, 6)}`;
      const submissionRef = db.collection('submissions').doc(submissionId);

      const submissionDoc = {
        id: submissionId,
        sessionId,
        examId: session.examId,
        examCode: exam.examCode,
        examTitle: exam.title,
        subject: exam.subject,
        level: exam.level,
        examMaxScore: Number(exam.maxScore || 20),
        teacherId: exam.teacherId,
        student: session.student,
        attemptNumber: session.attemptNumber || 1,
        startedAt: session.startedAt || nowIso,
        submittedAt: nowIso,
        durationSeconds,
        autoSubmitted: Boolean(autoSubmitted || now > deadlineMs),
        locked: true,
        answers: finalAnswers,
        questionsSnapshot: exam.questions || [],
        ...evalSummary,
        generalComment: '',
        showScoreToStudent: Boolean(exam.showScoreToStudent),
        showExpectedAnswersToStudent: Boolean(exam.showExpectedAnswersToStudent),
        emailNotification: {
          status: 'pending',
          attempts: 0,
        },
        integrityEvents: Array.isArray(integrityEvents)
          ? integrityEvents.slice(0, 200)
          : session.integrityEvents || [],
        auditTrail: [
          {
            id: crypto.randomUUID(),
            submissionId,
            examId: session.examId,
            teacherId: exam.teacherId,
            action: 'submission_locked',
            reason: autoSubmitted ? 'Soumission automatique à expiration du temps' : 'Soumission définitive par l’élève',
            timestamp: nowIso,
          },
        ],
      };

      tx.set(submissionRef, submissionDoc);
      tx.update(sessionRef, {
        status: 'submitted',
        submittedAt: nowIso,
        submissionId,
        locked: true,
        updatedAt: nowIso,
      });

      return { alreadySubmitted: false, submission: submissionDoc, submissionId, teacher };
    });

    const submission = txResult.submission;

    // Envoi de la notification par e-mail au professeur (si nouvelle soumission)
    if (!txResult.alreadySubmitted && txResult.teacher?.email) {
      const origin = (appOriginUrl || 'https://bachirtur.github.io/appcorrection').replace(/\/$/, '');
      const secureCopyUrl = `${origin}/#/professeur/copies?submissionId=${encodeURIComponent(submission.id)}`;
      const emailRes = await sendSubmissionEmailToTeacher(
        {
          teacherEmail: txResult.teacher.email,
          teacherEmailVerified: Boolean(txResult.teacher.emailVerified),
          examCode: submission.examCode,
          examTitle: submission.examTitle,
          studentFullName: `${submission.student.firstName} ${submission.student.lastName}`,
          className: submission.student.className,
          submittedAtIso: submission.submittedAt,
          validatedScoreDisplay:
            submission.gradingStatus === 'auto_graded'
              ? `${submission.normalizedScoreOn20}/20 (${submission.percentage}% — ${submission.appreciation})`
              : undefined,
          secureCopyUrl,
        },
        {
          resendApiKey: RESEND_API_KEY.value(),
          smtpHost: process.env.SMTP_HOST,
          smtpPort: process.env.SMTP_PORT,
          smtpUser: process.env.SMTP_USER,
          smtpPass: process.env.SMTP_PASS,
          mailFrom: process.env.MAIL_FROM,
        }
      );

      await db.collection('submissions').doc(submission.id).update({
        emailNotification: {
          ...emailRes,
          attempts: 1,
        },
      });
    }

    // Filtrage strict de la réponse élève selon les paramètres de restitution du professeur
    const canViewScore =
      Boolean(submission.showScoreToStudent) &&
      (submission.gradingStatus === 'auto_graded' || submission.gradingStatus === 'validated');
    const canViewExpected = canViewScore && Boolean(submission.showExpectedAnswersToStudent);

    const sanitizedGrades: Record<string, any> | undefined = canViewScore
      ? Object.fromEntries(
          Object.entries(submission.questionGrades || {}).map(([qid, g]: [string, any]) => [
            qid,
            {
              questionId: qid,
              pointsObtained: g.pointsObtained,
              maxPoints: g.maxPoints,
              state: g.state,
              comment: g.comment,
              expectedAnswerDisplay: canViewExpected ? g.expectedAnswerDisplay : undefined,
            },
          ])
        )
      : undefined;

    return {
      submissionId: submission.id,
      examCode: submission.examCode,
      examTitle: submission.examTitle,
      subject: submission.subject,
      student: submission.student,
      startedAt: submission.startedAt,
      submittedAt: submission.submittedAt,
      durationSeconds: submission.durationSeconds,
      autoSubmitted: submission.autoSubmitted,
      gradingStatus: submission.gradingStatus,
      canViewScore,
      canViewExpectedAnswers: canViewExpected,
      examMaxScore: submission.examMaxScore,
      rawPointsObtained: canViewScore ? submission.rawPointsObtained : undefined,
      rawPointsMax: canViewScore ? submission.rawPointsMax : undefined,
      finalScoreOutOfMax: canViewScore ? submission.finalScoreOutOfMax : undefined,
      normalizedScoreOn20: canViewScore ? submission.normalizedScoreOn20 : undefined,
      percentage: canViewScore ? submission.percentage : undefined,
      appreciation: canViewScore ? submission.appreciation : undefined,
      generalComment: canViewScore ? submission.generalComment : undefined,
      questions: submission.questionsSnapshot,
      answers: submission.answers,
      questionGrades: sanitizedGrades,
    };
  }
);

// ============================================================================
// 7. Correction / validation d'une copie par le professeur avec journal d'audit
// ============================================================================
export const updateSubmissionGrade = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification professeur requise.');
    }
    const uid = request.auth.uid;
    const {
      submissionId,
      questionGrades,
      generalComment,
      validateNow,
      auditReason,
    } = (request.data || {}) as {
      submissionId?: string;
      questionGrades?: Record<string, QuestionGrade>;
      generalComment?: string;
      validateNow?: boolean;
      auditReason?: string;
    };

    if (!submissionId || !questionGrades) {
      throw new HttpsError('invalid-argument', 'Paramètres de notation incomplets.');
    }

    const subRef = db.collection('submissions').doc(submissionId);
    const snap = await subRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Copie introuvable.');
    }
    const sub = snap.data()!;
    if (sub.teacherId !== uid) {
      throw new HttpsError('permission-denied', 'Accès interdit aux copies d’un autre professeur.');
    }

    const wasAlreadyValidated = sub.gradingStatus === 'validated';
    if (wasAlreadyValidated && (!auditReason || auditReason.trim().length < 3)) {
      throw new HttpsError(
        'invalid-argument',
        'Un motif de modification est obligatoire pour modifier une note déjà validée (traçabilité d’audit).'
      );
    }

    let rawObtained = 0;
    let rawMax = 0;
    const updatedGrades: Record<string, QuestionGrade> = {};

    for (const [qid, g] of Object.entries(questionGrades)) {
      const clamped = round2(Math.max(0, Math.min(Number(g.maxPoints || 0), Number(g.pointsObtained || 0))));
      updatedGrades[qid] = {
        ...g,
        pointsObtained: clamped,
        state: validateNow ? 'validated' : g.state,
      };
      rawObtained += clamped;
      rawMax += Number(g.maxPoints || 0);
    }

    const examMaxScore = Number(sub.examMaxScore || 20);
    if (Object.keys(updatedGrades).length === 0) {
      rawMax = examMaxScore;
    }

    const ratio = rawMax > 0 ? rawObtained / rawMax : 0;
    const percentage = round2(ratio * 100);
    const finalScoreOutOfMax = round2(ratio * examMaxScore);
    const normalizedScoreOn20 = round2(ratio * 20);
    const appreciation = computeAppreciation(normalizedScoreOn20);
    const nowIso = new Date().toISOString();

    const newStatus = validateNow ? 'validated' : sub.gradingStatus === 'validated' ? 'validated' : 'pending_review';

    const auditEntry = {
      id: crypto.randomUUID(),
      submissionId,
      examId: sub.examId,
      teacherId: uid,
      action: wasAlreadyValidated ? 'grade_modified_after_validation' : 'grade_validated',
      previousScoreOn20: sub.normalizedScoreOn20,
      newScoreOn20: normalizedScoreOn20,
      reason:
        auditReason?.trim() ||
        (validateNow ? 'Validation officielle de la correction par le professeur' : 'Mise à jour de la correction'),
      timestamp: nowIso,
    };

    await db.runTransaction(async (tx) => {
      tx.update(subRef, {
        questionGrades: updatedGrades,
        rawPointsObtained: round2(rawObtained),
        rawPointsMax: round2(rawMax),
        finalScoreOutOfMax,
        normalizedScoreOn20,
        percentage,
        appreciation,
        generalComment: generalComment ?? sub.generalComment ?? '',
        gradingStatus: newStatus,
        validatedAt: validateNow ? nowIso : sub.validatedAt || null,
        validatedBy: validateNow ? uid : sub.validatedBy || null,
        auditTrail: [...(sub.auditTrail || []), auditEntry],
      });
      tx.set(db.collection('auditLogs').doc(auditEntry.id), {
        ...auditEntry,
        createdAt: nowIso,
      });
    });

    return {
      submissionId,
      normalizedScoreOn20,
      finalScoreOutOfMax,
      percentage,
      appreciation,
      gradingStatus: newStatus,
      auditEntry,
    };
  }
);
