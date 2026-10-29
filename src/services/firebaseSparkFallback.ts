import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AuditLogEntry,
  Exam,
  ExamSessionInfo,
  IntegrityEvent,
  QuestionGradeResult,
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentSubmissionReceipt,
  Submission,
} from '../types';
import {
  computeAppreciation,
  evaluateFullSubmission,
  recalculateSummaryFromQuestionGrades,
  round2,
} from './grading';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHUNK_CHAR_SIZE = 600_000;

function randomReadableCode(groups = 3, groupLen = 4): string {
  const total = groups * groupLen;
  const arr = new Uint8Array(total);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < total; i++) {
    out += ALPHABET[arr[i] % ALPHABET.length];
  }
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    parts.push(out.slice(g * groupLen, (g + 1) * groupLen));
  }
  return parts.join('-');
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function isCloudFunctionUnavailableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = String((err as any)?.code || '').toLowerCase();
  return (
    code.includes('not-found') ||
    code.includes('unavailable') ||
    code.includes('internal') ||
    msg.includes('cors') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('not found') ||
    msg.includes('does not exist')
  );
}

export async function sparkSavePdfChunks(
  db: Firestore,
  teacherId: string,
  examId: string,
  kind: 'subject' | 'correction',
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  await sparkDeletePdfChunks(db, examId, kind);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fullBase64 = uint8ToBase64(bytes);
  const totalChunks = Math.max(1, Math.ceil(fullBase64.length / CHUNK_CHAR_SIZE));

  for (let idx = 0; idx < totalChunks; idx++) {
    const slice = fullBase64.slice(idx * CHUNK_CHAR_SIZE, (idx + 1) * CHUNK_CHAR_SIZE);
    const chunkId = `${examId}_${kind}_${String(idx).padStart(4, '0')}`;
    await setDoc(doc(db, 'examPdfChunks', chunkId), {
      examId,
      teacherId,
      kind,
      index: idx,
      totalChunks,
      fileName: file.name,
      data: slice,
      updatedAt: new Date().toISOString(),
    });
    onProgress?.(Math.round(((idx + 1) / totalChunks) * 100));
  }
}

export async function sparkReadPdfChunks(
  db: Firestore,
  examId: string,
  kind: 'subject' | 'correction'
): Promise<Uint8Array> {
  const snap = await getDocs(
    query(
      collection(db, 'examPdfChunks'),
      where('examId', '==', examId),
      where('kind', '==', kind)
    )
  );
  if (snap.empty) {
    throw new Error('Document PDF introuvable dans Firestore.');
  }
  const sorted = snap.docs
    .map((d) => d.data() as { index: number; data: string })
    .sort((a, b) => a.index - b.index);
  const joined = sorted.map((c) => c.data).join('');
  return base64ToUint8(joined);
}

export async function sparkDeletePdfChunks(
  db: Firestore,
  examId: string,
  kind: 'subject' | 'correction'
): Promise<void> {
  const snap = await getDocs(
    query(
      collection(db, 'examPdfChunks'),
      where('examId', '==', examId),
      where('kind', '==', kind)
    )
  );
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

export async function sparkPublishExam(
  db: Firestore,
  teacherId: string,
  examId: string,
  regenerateCode: boolean
) {
  const examRef = doc(db, 'exams', examId);
  const examSnap = await getDoc(examRef);
  if (!examSnap.exists()) throw new Error('Examen introuvable.');
  const exam = { id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) };
  if (exam.teacherId !== teacherId) throw new Error('Accès non autorisé.');

  if (!exam.hasSubjectPdf && (!exam.questions || exam.questions.length === 0)) {
    throw new Error(
      'Ajoutez au moins un sujet PDF ou une question interactive avant de publier cet examen.'
    );
  }

  const secretRef = doc(db, 'examSecrets', examId);
  const secretSnap = await getDoc(secretRef);
  const existingSecret = secretSnap.exists() ? secretSnap.data() : {};

  let plainCode: string | null = null;
  let accessCodeHash = existingSecret?.accessCodeHash;
  let accessCodeSalt = existingSecret?.accessCodeSalt;
  let accessCodePreviewHint = existingSecret?.accessCodePreviewHint;

  if (!accessCodeHash || regenerateCode) {
    plainCode = randomReadableCode(3, 4);
    const normalized = plainCode.replace(/[\s-]/g, '').toUpperCase();
    accessCodeSalt = randomReadableCode(2, 6);
    accessCodeHash = await sha256Hex(`${accessCodeSalt}:${normalized}`);
    accessCodePreviewHint = `${plainCode.slice(0, 4)}-****-${plainCode.slice(-4)}`;
  }

  const nowIso = new Date().toISOString();
  await setDoc(
    secretRef,
    {
      examId,
      teacherId,
      accessCodeHash,
      accessCodeSalt,
      accessCodePreviewHint,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  await updateDoc(examRef, {
    status: 'published',
    accessCodeHint: accessCodePreviewHint,
    updatedAt: nowIso,
  });

  return {
    examId,
    examCode: exam.examCode,
    accessCode: plainCode,
    accessCodePreviewHint,
    status: 'published' as const,
  };
}

export async function sparkVerifyStudentAccess(
  db: Firestore,
  req: {
    firstName: string;
    lastName: string;
    email?: string;
    className: string;
    examCode: string;
    accessCode: string;
  }
): Promise<ExamSessionInfo> {
  const cleanExamCode = req.examCode.trim().toUpperCase();
  const examsSnap = await getDocs(
    query(collection(db, 'exams'), where('examCode', '==', cleanExamCode))
  );
  if (examsSnap.empty) {
    throw new Error('Identifiant d’examen ou code d’accès invalide.');
  }
  const examDoc = examsSnap.docs[0];
  const exam = { id: examDoc.id, ...(examDoc.data() as Omit<Exam, 'id'>) };

  if (exam.status !== 'published') {
    throw new Error('Cet examen n’est pas ouvert actuellement.');
  }
  const nowMs = Date.now();
  const sMs = Date.parse(exam.startAt);
  const eMs = Date.parse(exam.endAt);
  if (Number.isFinite(sMs) && nowMs < sMs) {
    throw new Error('La période d’ouverture de cet examen n’a pas encore débuté.');
  }
  if (Number.isFinite(eMs) && nowMs > eMs) {
    throw new Error('La période de passation de cet examen est clôturée.');
  }

  const secretSnap = await getDoc(doc(db, 'examSecrets', exam.id));
  if (!secretSnap.exists()) {
    throw new Error('Configuration secrète de l’examen introuvable.');
  }
  const secret = secretSnap.data();
  const normalizedCode = req.accessCode.replace(/[\s-]/g, '').toUpperCase();
  const candidateHash = await sha256Hex(`${secret.accessCodeSalt}:${normalizedCode}`);
  if (candidateHash !== secret.accessCodeHash) {
    throw new Error('Identifiant d’examen ou code d’accès invalide.');
  }

  const fp = await sha256Hex(
    `${exam.id}:${req.lastName.trim().toLowerCase()}:${req.firstName.trim().toLowerCase()}:${req.className.trim().toLowerCase()}:${(req.email || '').trim().toLowerCase()}`
  );

  const existingSnap = await getDocs(
    query(
      collection(db, 'examSessions'),
      where('examId', '==', exam.id),
      where('studentFingerprint', '==', fp)
    )
  );
  const existingSessions = existingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const inProg = existingSessions.find(
    (s) => s.status === 'in_progress' || s.status === 'authorized_waiting'
  );
  const submittedCount = existingSessions.filter((s) => s.status === 'submitted').length;

  if (!inProg && submittedCount >= (exam.maxAttempts || 1)) {
    throw new Error(
      `Nombre maximal de tentatives atteint (${exam.maxAttempts || 1}) pour cet élève sur cet examen.`
    );
  }

  const nowIso = new Date().toISOString();
  if (inProg) {
    const deadlineMs = inProg.deadlineAt
      ? Date.parse(inProg.deadlineAt)
      : nowMs + exam.durationMinutes * 60_000;
    return {
      sessionId: inProg.id,
      sessionToken: inProg.sessionToken,
      examId: exam.id,
      examCode: exam.examCode,
      title: exam.title,
      subject: exam.subject,
      level: exam.level,
      className: exam.className,
      description: exam.description,
      language: exam.language || 'fr',
      durationMinutes: exam.durationMinutes,
      maxScore: exam.maxScore,
      allowSubjectDownload: exam.allowSubjectDownload,
      allowModifyBeforeSubmit: exam.allowModifyBeforeSubmit,
      autoSaveIntervalSeconds: exam.autoSaveIntervalSeconds,
      enableIntegrityMonitoring: exam.enableIntegrityMonitoring,
      hasSubjectPdf: exam.hasSubjectPdf,
      subjectFileName: exam.subjectFileName,
      questionCount: (exam.questions || []).length,
      questions: exam.questions || [],
      student: inProg.student,
      attemptNumber: inProg.attemptNumber,
      status: inProg.status,
      startedAt: inProg.startedAt,
      deadlineAt: inProg.deadlineAt,
      serverNow: nowIso,
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)),
      revision: Number(inProg.revision || 0),
      savedAnswers: inProg.savedAnswers || {},
      integrityEvents: inProg.integrityEvents || [],
    };
  }

  const sessionRef = doc(collection(db, 'examSessions'));
  const sessionToken = randomReadableCode(4, 6);
  const student = {
    firstName: req.firstName.trim(),
    lastName: req.lastName.trim(),
    email: (req.email || '').trim(),
    className: req.className.trim(),
  };

  await setDoc(sessionRef, {
    sessionId: sessionRef.id,
    sessionToken,
    examId: exam.id,
    examCode: exam.examCode,
    teacherId: exam.teacherId,
    studentFingerprint: fp,
    student,
    attemptNumber: submittedCount + 1,
    status: 'authorized_waiting',
    revision: 0,
    savedAnswers: {},
    integrityEvents: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return {
    sessionId: sessionRef.id,
    sessionToken,
    examId: exam.id,
    examCode: exam.examCode,
    title: exam.title,
    subject: exam.subject,
    level: exam.level,
    className: exam.className,
    description: exam.description,
    language: exam.language || 'fr',
    durationMinutes: exam.durationMinutes,
    maxScore: exam.maxScore,
    allowSubjectDownload: exam.allowSubjectDownload,
    allowModifyBeforeSubmit: exam.allowModifyBeforeSubmit,
    autoSaveIntervalSeconds: exam.autoSaveIntervalSeconds,
    enableIntegrityMonitoring: exam.enableIntegrityMonitoring,
    hasSubjectPdf: exam.hasSubjectPdf,
    subjectFileName: exam.subjectFileName,
    questionCount: (exam.questions || []).length,
    questions: exam.questions || [],
    student,
    attemptNumber: submittedCount + 1,
    status: 'authorized_waiting',
    serverNow: nowIso,
    remainingSeconds: exam.durationMinutes * 60,
    revision: 0,
    savedAnswers: {},
    integrityEvents: [],
  };
}

export async function sparkStartExamSession(
  db: Firestore,
  sessionId: string,
  sessionToken: string
): Promise<ExamSessionInfo> {
  const sessRef = doc(db, 'examSessions', sessionId);
  const sessSnap = await getDoc(sessRef);
  if (!sessSnap.exists()) throw new Error('Session introuvable.');
  const sess = sessSnap.data() as any;
  if (sess.sessionToken !== sessionToken) throw new Error('Jeton de session invalide.');

  const examSnap = await getDoc(doc(db, 'exams', sess.examId));
  if (!examSnap.exists()) throw new Error('Examen introuvable.');
  const exam = { id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) };

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let startedAt = sess.startedAt as string | undefined;
  let deadlineAt = sess.deadlineAt as string | undefined;

  if (!startedAt || !deadlineAt) {
    startedAt = nowIso;
    const examEndMs = Date.parse(exam.endAt);
    const computedEnd = nowMs + exam.durationMinutes * 60_000;
    const effectiveEnd = Number.isFinite(examEndMs) ? Math.min(computedEnd, examEndMs) : computedEnd;
    deadlineAt = new Date(effectiveEnd).toISOString();

    await updateDoc(sessRef, {
      status: 'in_progress',
      startedAt,
      deadlineAt,
      updatedAt: nowIso,
    });
  }

  return {
    sessionId,
    sessionToken,
    examId: exam.id,
    examCode: exam.examCode,
    title: exam.title,
    subject: exam.subject,
    level: exam.level,
    className: exam.className,
    description: exam.description,
    language: exam.language || 'fr',
    durationMinutes: exam.durationMinutes,
    maxScore: exam.maxScore,
    allowSubjectDownload: exam.allowSubjectDownload,
    allowModifyBeforeSubmit: exam.allowModifyBeforeSubmit,
    autoSaveIntervalSeconds: exam.autoSaveIntervalSeconds,
    enableIntegrityMonitoring: exam.enableIntegrityMonitoring,
    hasSubjectPdf: exam.hasSubjectPdf,
    subjectFileName: exam.subjectFileName,
    questionCount: (exam.questions || []).length,
    questions: exam.questions || [],
    student: sess.student,
    attemptNumber: sess.attemptNumber,
    status: 'in_progress',
    startedAt,
    deadlineAt,
    serverNow: nowIso,
    remainingSeconds: Math.max(0, Math.floor((Date.parse(deadlineAt) - nowMs) / 1000)),
    revision: Number(sess.revision || 0),
    savedAnswers: sess.savedAnswers || {},
    integrityEvents: sess.integrityEvents || [],
  };
}

export async function sparkReadStudentSubjectPdf(
  db: Firestore,
  sessionId: string,
  sessionToken: string
): Promise<{ bytes: Uint8Array; fileName: string; allowDownload: boolean }> {
  const sessSnap = await getDoc(doc(db, 'examSessions', sessionId));
  if (!sessSnap.exists()) throw new Error('Session introuvable.');
  const sess = sessSnap.data() as any;
  if (sess.sessionToken !== sessionToken) throw new Error('Jeton invalide.');
  if (sess.status !== 'in_progress' && sess.status !== 'submitted') {
    throw new Error('Veuillez démarrer l’épreuve pour consulter le sujet.');
  }

  const examSnap = await getDoc(doc(db, 'exams', sess.examId));
  if (!examSnap.exists()) throw new Error('Examen introuvable.');
  const exam = examSnap.data() as Exam;
  const bytes = await sparkReadPdfChunks(db, sess.examId, 'subject');
  return {
    bytes,
    fileName: exam.subjectFileName || 'Sujet_Examen.pdf',
    allowDownload: Boolean(exam.allowSubjectDownload),
  };
}

export async function sparkAutosaveAnswers(
  db: Firestore,
  sessionId: string,
  sessionToken: string,
  answers: Record<string, StudentAnswerValue>,
  clientRevision: number,
  integrityEvents: IntegrityEvent[]
) {
  const sessRef = doc(db, 'examSessions', sessionId);
  const sessSnap = await getDoc(sessRef);
  if (!sessSnap.exists()) throw new Error('Session introuvable.');
  const sess = sessSnap.data() as any;
  if (sess.sessionToken !== sessionToken) throw new Error('Jeton invalide.');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const nextRevision = Math.max(Number(sess.revision || 0), clientRevision) + 1;
  const deadlineMs = sess.deadlineAt ? Date.parse(sess.deadlineAt) : nowMs;

  await updateDoc(sessRef, {
    savedAnswers: answers,
    integrityEvents,
    revision: nextRevision,
    updatedAt: nowIso,
  });

  return {
    savedAt: nowIso,
    serverNow: nowIso,
    remainingSeconds: Math.max(0, Math.floor((deadlineMs - nowMs) / 1000)),
    revision: nextRevision,
    conflictDetected: false,
  };
}

export async function sparkSubmitExamCopy(
  db: Firestore,
  sessionId: string,
  sessionToken: string,
  answers: Record<string, StudentAnswerValue>,
  integrityEvents: IntegrityEvent[],
  autoSubmitted: boolean
): Promise<StudentSubmissionReceipt> {
  const sessRef = doc(db, 'examSessions', sessionId);
  const sessSnap = await getDoc(sessRef);
  if (!sessSnap.exists()) throw new Error('Session introuvable.');
  const sess = sessSnap.data() as any;
  if (sess.sessionToken !== sessionToken) throw new Error('Jeton invalide.');

  const examSnap = await getDoc(doc(db, 'exams', sess.examId));
  if (!examSnap.exists()) throw new Error('Examen introuvable.');
  const exam = { id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) };

  const secretSnap = await getDoc(doc(db, 'examSecrets', exam.id));
  const rubrics: Record<string, QuestionRubricSecret> = secretSnap.exists()
    ? secretSnap.data()?.rubrics || {}
    : {};

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const startedMs = sess.startedAt ? Date.parse(sess.startedAt) : nowMs;
  const durationSeconds = Math.max(1, Math.round((nowMs - startedMs) / 1000));

  const evaluation = evaluateFullSubmission(
    exam.questions || [],
    rubrics,
    answers,
    exam.maxScore
  );

  const subPublicId = `SUB-${new Date().getUTCFullYear()}-${randomReadableCode(1, 6)}`;
  const submission: Submission = {
    id: subPublicId,
    sessionId,
    examId: exam.id,
    examCode: exam.examCode,
    examTitle: exam.title,
    subject: exam.subject,
    level: exam.level,
    examMaxScore: exam.maxScore,
    teacherId: exam.teacherId,
    student: sess.student,
    attemptNumber: sess.attemptNumber || 1,
    startedAt: sess.startedAt || nowIso,
    submittedAt: nowIso,
    durationSeconds,
    autoSubmitted,
    locked: true,
    answers,
    questionsSnapshot: exam.questions || [],
    questionGrades: evaluation.questionGrades,
    rawPointsObtained: evaluation.rawPointsObtained,
    rawPointsMax: evaluation.rawPointsMax,
    finalScoreOutOfMax: evaluation.finalScoreOutOfMax,
    normalizedScoreOn20: evaluation.normalizedScoreOn20,
    percentage: evaluation.percentage,
    appreciation: evaluation.appreciation,
    generalComment: '',
    gradingStatus: evaluation.gradingStatus,
    showScoreToStudent: exam.showScoreToStudent,
    showExpectedAnswersToStudent: exam.showExpectedAnswersToStudent,
    emailNotification: {
      status: 'logged_no_smtp',
      attempts: 1,
    },
    integrityEvents: integrityEvents || [],
    auditTrail: [],
  };

  await setDoc(doc(db, 'submissions', subPublicId), submission);
  await updateDoc(sessRef, {
    status: 'submitted',
    submittedAt: nowIso,
    submissionId: subPublicId,
    savedAnswers: answers,
  });

  const canViewScore =
    Boolean(exam.showScoreToStudent) &&
    (submission.gradingStatus === 'auto_graded' || submission.gradingStatus === 'validated');
  const canViewExpectedAnswers = canViewScore && Boolean(exam.showExpectedAnswersToStudent);

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
    canViewExpectedAnswers,
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
    questionGrades: canViewScore ? submission.questionGrades : undefined,
  };
}

export async function sparkUpdateSubmissionGrade(
  db: Firestore,
  teacherId: string,
  submissionId: string,
  payload: {
    questionGrades?: Record<string, QuestionGradeResult>;
    manualDirectScoreOutOfMax?: number;
    generalComment?: string;
    validateNow?: boolean;
    showScoreToStudent?: boolean;
    showExpectedAnswersToStudent?: boolean;
    auditReason?: string;
  }
): Promise<void> {
  const subRef = doc(db, 'submissions', submissionId);
  const subSnap = await getDoc(subRef);
  if (!subSnap.exists()) throw new Error('Copie introuvable.');
  const sub = subSnap.data() as Submission;
  if (sub.teacherId !== teacherId) throw new Error('Accès refusé.');

  const wasValidated = sub.gradingStatus === 'validated';
  const previousScoreOn20 = sub.normalizedScoreOn20;

  const updatedGrades = payload.questionGrades || sub.questionGrades;
  let totals = recalculateSummaryFromQuestionGrades(
    updatedGrades,
    sub.examMaxScore,
    Boolean(payload.validateNow) || wasValidated
  );

  if (typeof payload.manualDirectScoreOutOfMax === 'number') {
    const clamped = Math.max(0, Math.min(sub.examMaxScore, payload.manualDirectScoreOutOfMax));
    const ratio = sub.examMaxScore > 0 ? clamped / sub.examMaxScore : 0;
    const norm20 = round2(ratio * 20);
    totals = {
      rawPointsObtained: round2(clamped),
      rawPointsMax: sub.examMaxScore,
      finalScoreOutOfMax: round2(clamped),
      normalizedScoreOn20: norm20,
      percentage: round2(ratio * 100),
      appreciation: computeAppreciation(norm20),
      gradingStatus: payload.validateNow || wasValidated ? 'validated' : 'auto_graded',
    };
  }

  if (wasValidated && totals.normalizedScoreOn20 !== previousScoreOn20 && !payload.auditReason?.trim()) {
    throw new Error(
      'Une justification d’audit est obligatoire pour modifier une note déjà validée.'
    );
  }

  const nowIso = new Date().toISOString();
  const auditTrail: AuditLogEntry[] = [...(sub.auditTrail || [])];
  if (wasValidated && totals.normalizedScoreOn20 !== previousScoreOn20) {
    const entry: AuditLogEntry = {
      id: `AUD-${Date.now()}`,
      submissionId,
      examId: sub.examId,
      teacherId,
      action: 'grade_modified_after_validation',
      previousScoreOn20,
      newScoreOn20: totals.normalizedScoreOn20,
      reason: payload.auditReason!.trim(),
      timestamp: nowIso,
    };
    auditTrail.push(entry);
    await setDoc(doc(db, 'auditLogs', entry.id), entry);
  }

  await updateDoc(subRef, {
    questionGrades: updatedGrades,
    ...totals,
    generalComment:
      payload.generalComment !== undefined ? payload.generalComment : sub.generalComment,
    showScoreToStudent:
      payload.showScoreToStudent !== undefined
        ? payload.showScoreToStudent
        : sub.showScoreToStudent,
    showExpectedAnswersToStudent:
      payload.showExpectedAnswersToStudent !== undefined
        ? payload.showExpectedAnswersToStudent
        : sub.showExpectedAnswersToStudent,
    validatedAt: payload.validateNow ? nowIso : sub.validatedAt || '',
    auditTrail,
  });
}
