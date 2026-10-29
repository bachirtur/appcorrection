import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  EmailNotificationStatus,
  ExamSessionInfo,
  IntegrityEvent,
  IntegrityEventType,
  QuestionGradeResult,
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentSubmissionReceipt,
  Submission,
} from '../types';
import { getActiveBackendMode, getApiBaseUrl, getFirebaseServices } from './firebase';
import { apiRequest } from './auth';
import {
  isCloudFunctionUnavailableError,
  sparkAutosaveAnswers,
  sparkReadStudentSubjectPdf,
  sparkStartExamSession,
  sparkSubmitExamCopy,
  sparkUpdateSubmissionGrade,
  sparkVerifyStudentAccess,
} from './firebaseSparkFallback';

const ACTIVE_SESSION_STORAGE_KEY = 'eduexam_student_session_ctx';

export interface StoredStudentSessionCtx {
  sessionId: string;
  sessionToken: string;
  examCode: string;
  submissionId?: string;
}

export function saveStudentSessionCtx(ctx: StoredStudentSessionCtx | null): void {
  if (!ctx) {
    sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } else {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(ctx));
  }
}

export function loadStudentSessionCtx(): StoredStudentSessionCtx | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredStudentSessionCtx) : null;
  } catch {
    return null;
  }
}

export function saveLocalDraftBackup(
  sessionId: string,
  answers: Record<string, StudentAnswerValue>
): void {
  try {
    localStorage.setItem(
      `eduexam_draft_${sessionId}`,
      JSON.stringify({ savedAt: new Date().toISOString(), answers })
    );
  } catch {
    // quota exceeded fallback ignored
  }
}

export function loadLocalDraftBackup(
  sessionId: string
): { savedAt: string; answers: Record<string, StudentAnswerValue> } | null {
  try {
    const raw = localStorage.getItem(`eduexam_draft_${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocalDraftBackup(sessionId: string): void {
  try {
    localStorage.removeItem(`eduexam_draft_${sessionId}`);
  } catch {
    // ignore
  }
}

export interface StudentAccessRequest {
  firstName: string;
  lastName: string;
  email?: string;
  className: string;
  examCode: string;
  accessCode: string;
}

export async function verifyStudentAccess(
  req: StudentAccessRequest
): Promise<ExamSessionInfo> {
  if (getActiveBackendMode() === 'firebase') {
    const { db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<StudentAccessRequest, ExamSessionInfo>(
        functions,
        'verifyStudentExamAccess'
      );
      const res = await fn(req);
      saveStudentSessionCtx({
        sessionId: res.data.sessionId,
        sessionToken: res.data.sessionToken,
        examCode: res.data.examCode,
      });
      return res.data;
    } catch (err) {
      if (isCloudFunctionUnavailableError(err)) {
        const session = await sparkVerifyStudentAccess(db, req);
        saveStudentSessionCtx({
          sessionId: session.sessionId,
          sessionToken: session.sessionToken,
          examCode: session.examCode,
        });
        return session;
      }
      throw err;
    }
  }

  const session = await apiRequest<ExamSessionInfo>('/api/student/access', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  saveStudentSessionCtx({
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    examCode: session.examCode,
    submissionId: session.submissionId,
  });
  return session;
}

export async function refreshStudentSession(
  sessionId: string,
  sessionToken: string
): Promise<ExamSessionInfo> {
  if (getActiveBackendMode() === 'firebase') {
    throw new Error('Utilisez le formulaire d’identification pour reprendre la session.');
  }
  return apiRequest<ExamSessionInfo>(
    `/api/student/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
    sessionToken
  );
}

export async function startStudentExam(
  sessionId: string,
  sessionToken: string
): Promise<ExamSessionInfo> {
  if (getActiveBackendMode() === 'firebase') {
    const { db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<
        { sessionId: string; sessionToken: string },
        Partial<ExamSessionInfo>
      >(functions, 'startExamSession');
      const res = await fn({ sessionId, sessionToken });
      return res.data as ExamSessionInfo;
    } catch (err) {
      if (isCloudFunctionUnavailableError(err)) {
        return sparkStartExamSession(db, sessionId, sessionToken);
      }
      throw err;
    }
  }

  return apiRequest<ExamSessionInfo>(
    `/api/student/sessions/${encodeURIComponent(sessionId)}/start`,
    { method: 'POST', body: JSON.stringify({}) },
    sessionToken
  );
}

export async function fetchStudentSubjectPdfBytes(
  sessionId: string,
  sessionToken: string
): Promise<{ bytes: Uint8Array; fileName: string; allowDownload: boolean }> {
  if (getActiveBackendMode() === 'firebase') {
    const { db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<
        { sessionId: string; sessionToken: string },
        { temporaryUrl: string; fileName: string; allowDownload: boolean }
      >(functions, 'getSubjectPdfUrl');
      const res = await fn({ sessionId, sessionToken });
      const pdfResp = await fetch(res.data.temporaryUrl);
      if (!pdfResp.ok) throw new Error('Échec du chargement temporaire du sujet PDF.');
      const buf = await pdfResp.arrayBuffer();
      return {
        bytes: new Uint8Array(buf),
        fileName: res.data.fileName,
        allowDownload: res.data.allowDownload,
      };
    } catch (err) {
      if (isCloudFunctionUnavailableError(err)) {
        return sparkReadStudentSubjectPdf(db, sessionId, sessionToken);
      }
      throw err;
    }
  }

  const tokenInfo = await apiRequest<{
    viewUrl: string;
    downloadUrl: string | null;
    fileName: string;
    allowDownload: boolean;
  }>(
    `/api/student/sessions/${encodeURIComponent(sessionId)}/subject-token`,
    { method: 'POST', body: JSON.stringify({}) },
    sessionToken
  );

  const base = getApiBaseUrl();
  const pdfResp = await fetch(`${base}${tokenInfo.viewUrl}`);
  if (!pdfResp.ok) {
    throw new Error('Impossible de charger le sujet PDF autorisé.');
  }
  const buf = await pdfResp.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    fileName: tokenInfo.fileName,
    allowDownload: tokenInfo.allowDownload,
  };
}

export async function downloadStudentSubjectPdfFile(
  sessionId: string,
  sessionToken: string
): Promise<void> {
  const { bytes, fileName, allowDownload } = await fetchStudentSubjectPdfBytes(
    sessionId,
    sessionToken
  );
  if (!allowDownload) {
    throw new Error('Le téléchargement hors ligne du sujet n’est pas autorisé pour cet examen.');
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName || 'Sujet_Examen.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

export interface AutosaveResponse {
  savedAt: string;
  serverNow: string;
  remainingSeconds: number;
  revision: number;
  conflictDetected: boolean;
}

export async function autosaveStudentAnswers(
  sessionId: string,
  sessionToken: string,
  answers: Record<string, StudentAnswerValue>,
  clientRevision: number,
  integrityEvents: IntegrityEvent[]
): Promise<AutosaveResponse> {
  saveLocalDraftBackup(sessionId, answers);

  if (getActiveBackendMode() === 'firebase') {
    const { db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<any, AutosaveResponse>(functions, 'saveDraftAnswers');
      const res = await fn({
        sessionId,
        sessionToken,
        answers,
        clientRevision,
        integrityEvents,
      });
      return res.data;
    } catch (err) {
      if (isCloudFunctionUnavailableError(err)) {
        return sparkAutosaveAnswers(db, sessionId, sessionToken, answers, clientRevision, integrityEvents);
      }
      throw err;
    }
  }

  return apiRequest<AutosaveResponse>(
    `/api/student/sessions/${encodeURIComponent(sessionId)}/autosave`,
    {
      method: 'POST',
      body: JSON.stringify({ answers, clientRevision, integrityEvents }),
    },
    sessionToken
  );
}

export async function logStudentIntegrityEvent(
  sessionId: string,
  sessionToken: string,
  type: IntegrityEventType,
  details: string
): Promise<IntegrityEvent | null> {
  if (getActiveBackendMode() === 'firebase') {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      timestamp: new Date().toISOString(),
      details,
    };
  }

  try {
    const res = await apiRequest<{ logged: boolean; event?: IntegrityEvent }>(
      `/api/student/sessions/${encodeURIComponent(sessionId)}/integrity`,
      {
        method: 'POST',
        body: JSON.stringify({ type, details }),
      },
      sessionToken
    );
    return res.event || null;
  } catch {
    return null;
  }
}

export async function submitFinalExamCopy(
  sessionId: string,
  sessionToken: string,
  answers: Record<string, StudentAnswerValue>,
  integrityEvents: IntegrityEvent[],
  autoSubmitted = false
): Promise<StudentSubmissionReceipt> {
  const appOriginUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`
      : '';

  if (getActiveBackendMode() === 'firebase') {
    const { db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<any, StudentSubmissionReceipt>(functions, 'submitExamCopy');
      const res = await fn({
        sessionId,
        sessionToken,
        answers,
        integrityEvents,
        autoSubmitted,
        appOriginUrl,
      });
      clearLocalDraftBackup(sessionId);
      return res.data;
    } catch (err) {
      if (isCloudFunctionUnavailableError(err)) {
        const receipt = await sparkSubmitExamCopy(
          db,
          sessionId,
          sessionToken,
          answers,
          integrityEvents,
          autoSubmitted
        );
        clearLocalDraftBackup(sessionId);
        return receipt;
      }
      throw err;
    }
  }

  const res = await apiRequest<{ alreadySubmitted: boolean; receipt: StudentSubmissionReceipt }>(
    `/api/student/sessions/${encodeURIComponent(sessionId)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({
        answers,
        integrityEvents,
        autoSubmitted,
        appOriginUrl,
      }),
    },
    sessionToken
  );

  clearLocalDraftBackup(sessionId);
  saveStudentSessionCtx({
    sessionId,
    sessionToken,
    examCode: res.receipt.examCode,
    submissionId: res.receipt.submissionId,
  });
  return res.receipt;
}

export async function fetchStudentSubmissionReceipt(
  submissionId: string,
  sessionToken: string
): Promise<StudentSubmissionReceipt> {
  return apiRequest<{ receipt: StudentSubmissionReceipt }>(
    `/api/student/receipt/${encodeURIComponent(submissionId)}`,
    { method: 'GET' },
    sessionToken
  ).then((r) => r.receipt);
}

// ============================================================================
// Gestion des copies côté Professeur
// ============================================================================
export interface SubmissionFilters {
  examId?: string;
  className?: string;
  subject?: string;
  gradingStatus?: string;
  minScore?: string;
  maxScore?: string;
  fromDate?: string;
  toDate?: string;
}

export async function listTeacherSubmissions(
  filters: SubmissionFilters = {}
): Promise<Submission[]> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const snap = await getDocs(
      query(
        collection(db, 'submissions'),
        where('teacherId', '==', uid),
        orderBy('submittedAt', 'desc')
      )
    );
    let items = snap.docs.map((d) => d.data() as Submission);

    if (filters.examId) items = items.filter((s) => s.examId === filters.examId);
    if (filters.className) {
      const q = filters.className.toLowerCase();
      items = items.filter((s) => s.student.className.toLowerCase().includes(q));
    }
    if (filters.subject) {
      const q = filters.subject.toLowerCase();
      items = items.filter((s) => s.subject.toLowerCase().includes(q));
    }
    if (filters.gradingStatus) {
      items = items.filter((s) => s.gradingStatus === filters.gradingStatus);
    }
    if (filters.minScore !== undefined && filters.minScore !== '') {
      items = items.filter((s) => s.normalizedScoreOn20 >= Number(filters.minScore));
    }
    if (filters.maxScore !== undefined && filters.maxScore !== '') {
      items = items.filter((s) => s.normalizedScoreOn20 <= Number(filters.maxScore));
    }
    if (filters.fromDate) {
      const fMs = Date.parse(filters.fromDate);
      if (Number.isFinite(fMs)) items = items.filter((s) => Date.parse(s.submittedAt) >= fMs);
    }
    if (filters.toDate) {
      const tMs = Date.parse(filters.toDate) + 86399_999;
      if (Number.isFinite(tMs)) items = items.filter((s) => Date.parse(s.submittedAt) <= tMs);
    }
    return items;
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, v);
  });
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await apiRequest<{ submissions: Submission[] }>(`/api/submissions${qs}`);
  return res.submissions;
}

export async function getSubmissionForTeacherGrading(submissionId: string): Promise<{
  submission: Submission;
  rubrics: Record<string, QuestionRubricSecret>;
  hasCorrectionPdf: boolean;
  hasSubjectPdf: boolean;
}> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const subSnap = await getDoc(doc(db, 'submissions', submissionId));
    if (!subSnap.exists()) throw new Error('Copie introuvable.');
    const submission = subSnap.data() as Submission;
    if (submission.teacherId !== uid) throw new Error('Accès refusé.');

    const secretSnap = await getDoc(doc(db, 'examSecrets', submission.examId));
    const examSnap = await getDoc(doc(db, 'exams', submission.examId));
    return {
      submission,
      rubrics: secretSnap.exists() ? secretSnap.data()?.rubrics || {} : {},
      hasCorrectionPdf: Boolean(examSnap.exists() && examSnap.data()?.hasCorrectionPdf),
      hasSubjectPdf: Boolean(examSnap.exists() && examSnap.data()?.hasSubjectPdf),
    };
  }

  return apiRequest(`/api/submissions/${encodeURIComponent(submissionId)}`);
}

export interface UpdateGradePayload {
  questionGrades?: Record<string, QuestionGradeResult>;
  manualDirectScoreOutOfMax?: number;
  generalComment?: string;
  validateNow?: boolean;
  showScoreToStudent?: boolean;
  showExpectedAnswersToStudent?: boolean;
  auditReason?: string;
}

export async function saveTeacherSubmissionGrade(
  submissionId: string,
  payload: UpdateGradePayload
): Promise<Submission> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable(functions, 'updateSubmissionGrade');
      await fn({ submissionId, ...payload });
    } catch (err) {
      if (isCloudFunctionUnavailableError(err) && auth.currentUser) {
        await sparkUpdateSubmissionGrade(db, auth.currentUser.uid, submissionId, payload);
      } else {
        throw err;
      }
    }
    const refreshed = await getSubmissionForTeacherGrading(submissionId);
    return refreshed.submission;
  }

  const res = await apiRequest<{ submission: Submission }>(
    `/api/submissions/${encodeURIComponent(submissionId)}/grade`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
  return res.submission;
}

export async function resendTeacherSubmissionEmail(
  submissionId: string,
  pdfBase64?: string
): Promise<EmailNotificationStatus> {
  const appOriginUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`
      : '';

  const res = await apiRequest<{ emailNotification: EmailNotificationStatus }>(
    `/api/submissions/${encodeURIComponent(submissionId)}/resend-email`,
    {
      method: 'POST',
      body: JSON.stringify({ appOriginUrl, pdfBase64 }),
    }
  );
  return res.emailNotification;
}

export async function deleteTeacherSubmission(submissionId: string): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    const { db } = getFirebaseServices();
    await deleteDoc(doc(db, 'submissions', submissionId));
    return;
  }
  await apiRequest(`/api/submissions/${encodeURIComponent(submissionId)}`, {
    method: 'DELETE',
  });
}
