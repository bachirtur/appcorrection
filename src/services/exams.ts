import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import {
  DashboardMetrics,
  Exam,
  ExamStatus,
  ExamWithSecrets,
  FullQuestionEditorItem,
  QuestionRubricSecret,
  StudentQuestionView,
  Submission,
} from '../types';
import { round2 } from './grading';
import { getActiveBackendMode, getApiBaseUrl, getFirebaseServices } from './firebase';
import { apiRequest, confirmTeacherIdentity, getStoredTeacherToken } from './auth';
import {
  isCloudFunctionUnavailableError,
  sparkDeletePdfChunks,
  sparkPublishExam,
  sparkReadPdfChunks,
  sparkSavePdfChunks,
} from './firebaseSparkFallback';

function splitEditorItems(items: FullQuestionEditorItem[]) {
  const publicQuestions: StudentQuestionView[] = [];
  const rubrics: Record<string, QuestionRubricSecret> = {};
  for (const item of items) {
    const { rubric, ...pub } = item;
    publicQuestions.push(pub);
    rubrics[item.id] = { ...rubric, questionId: item.id };
  }
  return { publicQuestions, rubrics };
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Authentification requise.');

    const examsSnap = await getDocs(
      query(collection(db, 'exams'), where('teacherId', '==', uid), orderBy('createdAt', 'desc'))
    );
    const subsSnap = await getDocs(
      query(
        collection(db, 'submissions'),
        where('teacherId', '==', uid),
        orderBy('submittedAt', 'desc')
      )
    );

    const myExams = examsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Exam, 'id'>) }));
    const mySubmissions = subsSnap.docs.map((d) => d.data() as Submission);

    const now = Date.now();
    let publishedExams = 0;
    let activeExamsNow = 0;
    let finishedExams = 0;

    for (const ex of myExams) {
      const sMs = Date.parse(ex.startAt);
      const eMs = Date.parse(ex.endAt);
      if (ex.status === 'published') {
        publishedExams += 1;
        if ((!Number.isFinite(sMs) || now >= sMs) && (!Number.isFinite(eMs) || now <= eMs)) {
          activeExamsNow += 1;
        } else if (Number.isFinite(eMs) && now > eMs) {
          finishedExams += 1;
        }
      } else if (ex.status === 'closed' || ex.status === 'archived') {
        finishedExams += 1;
      }
    }

    const graded = mySubmissions.filter(
      (s) => s.gradingStatus === 'auto_graded' || s.gradingStatus === 'validated'
    );
    const globalAverageOn20 =
      graded.length > 0
        ? round2(graded.reduce((a, b) => a + b.normalizedScoreOn20, 0) / graded.length)
        : null;
    const passRatePercent =
      graded.length > 0
        ? round2((graded.filter((s) => s.normalizedScoreOn20 >= 10).length / graded.length) * 100)
        : null;

    const examAverages = myExams.map((ex) => {
      const subs = mySubmissions.filter((s) => s.examId === ex.id);
      const g = subs.filter(
        (s) => s.gradingStatus === 'auto_graded' || s.gradingStatus === 'validated'
      );
      return {
        examId: ex.id,
        examCode: ex.examCode,
        title: ex.title,
        subject: ex.subject,
        className: ex.className,
        submissionCount: subs.length,
        averageOn20:
          g.length > 0 ? round2(g.reduce((a, b) => a + b.normalizedScoreOn20, 0) / g.length) : null,
        passRatePercent:
          g.length > 0
            ? round2((g.filter((s) => s.normalizedScoreOn20 >= 10).length / g.length) * 100)
            : null,
      };
    });

    return {
      totalExams: myExams.length,
      publishedExams,
      activeExamsNow,
      finishedExams,
      totalSubmissions: mySubmissions.length,
      globalAverageOn20,
      passRatePercent,
      examAverages,
      recentSubmissions: mySubmissions.slice(0, 8),
    };
  }

  return apiRequest<DashboardMetrics>('/api/teacher/dashboard');
}

export async function listTeacherExams(): Promise<Exam[]> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');
    const snap = await getDocs(
      query(collection(db, 'exams'), where('teacherId', '==', uid), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Exam, 'id'>) }));
  }

  const res = await apiRequest<{ exams: Exam[] }>('/api/exams');
  return res.exams;
}

export async function getTeacherExamWithSecrets(examId: string): Promise<ExamWithSecrets> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const examSnap = await getDoc(doc(db, 'exams', examId));
    if (!examSnap.exists()) throw new Error('Examen introuvable.');
    const exam = { id: examSnap.id, ...(examSnap.data() as Omit<Exam, 'id'>) };
    if (exam.teacherId !== uid) throw new Error('Accès refusé.');

    const secretSnap = await getDoc(doc(db, 'examSecrets', examId));
    const secret = secretSnap.exists() ? secretSnap.data() : {};
    return {
      ...exam,
      rubrics: secret?.rubrics || {},
      accessCodePreviewHint: secret?.accessCodePreviewHint,
    };
  }

  const res = await apiRequest<{ exam: ExamWithSecrets }>(`/api/exams/${encodeURIComponent(examId)}`);
  return res.exam;
}

export interface SaveExamPayload extends Partial<Exam> {
  editorQuestions?: FullQuestionEditorItem[];
}

export async function createExamDraft(payload: SaveExamPayload): Promise<ExamWithSecrets> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const examRef = doc(collection(db, 'exams'));
    const nowIso = new Date().toISOString();
    const randSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const examCode = `EXM-${new Date().getUTCFullYear()}-${randSuffix}`;

    const { publicQuestions, rubrics } = splitEditorItems(payload.editorQuestions || []);
    const examData: Exam = {
      id: examRef.id,
      examCode,
      teacherId: uid,
      title: payload.title || 'Nouvel examen',
      subject: payload.subject || 'Mathématiques',
      level: payload.level || 'lycee',
      className: payload.className || 'Terminale',
      description: payload.description || '',
      durationMinutes: payload.durationMinutes || 60,
      startAt: payload.startAt || nowIso,
      endAt: payload.endAt || new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      maxScore: payload.maxScore || 20,
      language: payload.language || 'fr',
      maxAttempts: payload.maxAttempts || 1,
      allowModifyBeforeSubmit: payload.allowModifyBeforeSubmit !== false,
      requireStudentEmail: Boolean(payload.requireStudentEmail),
      allowSubjectDownload: payload.allowSubjectDownload !== false,
      showScoreToStudent: payload.showScoreToStudent !== false,
      showExpectedAnswersToStudent: Boolean(payload.showExpectedAnswersToStudent),
      autoSaveIntervalSeconds: payload.autoSaveIntervalSeconds || 20,
      enableIntegrityMonitoring: payload.enableIntegrityMonitoring !== false,
      defaultGradingMode: payload.defaultGradingMode || 'mode_a_auto',
      maxPdfSizeMb: payload.maxPdfSizeMb || 15,
      hasSubjectPdf: false,
      hasCorrectionPdf: false,
      questions: publicQuestions,
      status: 'draft',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await setDoc(examRef, examData);
    await setDoc(doc(db, 'examSecrets', examRef.id), {
      examId: examRef.id,
      teacherId: uid,
      rubrics,
      updatedAt: nowIso,
    });

    return { ...examData, rubrics };
  }

  const res = await apiRequest<{ exam: ExamWithSecrets }>('/api/exams', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.exam;
}

export async function updateExamDraft(
  examId: string,
  payload: SaveExamPayload
): Promise<ExamWithSecrets> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const nowIso = new Date().toISOString();
    const { editorQuestions, ...rest } = payload;
    const examUpdate: Record<string, any> = { ...rest, updatedAt: nowIso };
    delete examUpdate.id;
    delete examUpdate.teacherId;

    if (editorQuestions) {
      const { publicQuestions, rubrics } = splitEditorItems(editorQuestions);
      examUpdate.questions = publicQuestions;
      await setDoc(
        doc(db, 'examSecrets', examId),
        {
          examId,
          teacherId: uid,
          rubrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }

    await updateDoc(doc(db, 'exams', examId), examUpdate);
    return getTeacherExamWithSecrets(examId);
  }

  const res = await apiRequest<{ exam: ExamWithSecrets }>(
    `/api/exams/${encodeURIComponent(examId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
  return res.exam;
}

export async function uploadExamPrivatePdf(
  examId: string,
  kind: 'subject' | 'correction',
  file: File,
  maxSizeMb: number,
  onProgress?: (percent: number) => void
): Promise<{ fileName: string; fileSize: number }> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Seuls les documents au format PDF sont acceptés.');
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`Le fichier dépasse la taille maximale autorisée (${maxSizeMb} Mo).`);
  }

  // Vérification côté client de l'en-tête %PDF- avant l'envoi
  const headerSlice = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const headerText = String.fromCharCode(...headerSlice);
  if (headerText !== '%PDF-') {
    throw new Error('Le fichier sélectionné n’est pas un document PDF valide.');
  }

  if (getActiveBackendMode() === 'firebase') {
    const { auth, db, storage } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const folder = kind === 'subject' ? 'private_subject/subject.pdf' : 'confidential_correction/correction.pdf';
    const sRef = storageRef(storage, `exams/${uid}/${examId}/${folder}`);
    try {
      const uploadTask = uploadBytesResumable(sRef, file, {
        contentType: 'application/pdf',
        customMetadata: { originalName: file.name },
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snap) => {
            if (onProgress && snap.totalBytes > 0) {
              onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
            }
          },
          (err) => reject(err),
          () => resolve()
        );
      });
    } catch {
      // Plan gratuit Firebase Spark sans Cloud Storage activé : stockage fragmenté Firestore
      await sparkSavePdfChunks(db, uid, examId, kind, file, onProgress);
    }

    const fieldUpdate =
      kind === 'subject'
        ? { hasSubjectPdf: true, subjectFileName: file.name, subjectFileSize: file.size }
        : { hasCorrectionPdf: true, correctionFileName: file.name, correctionFileSize: file.size };

    await updateDoc(doc(db, 'exams', examId), {
      ...fieldUpdate,
      updatedAt: new Date().toISOString(),
    });

    return { fileName: file.name, fileSize: file.size };
  }

  // Envoi avec suivi réel de progression XHR vers /api/exams/:examId/upload-pdf
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const base = getApiBaseUrl();
    xhr.open('POST', `${base}/api/exams/${encodeURIComponent(examId)}/upload-pdf`);
    const token = getStoredTeacherToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve({ fileName: json.fileName, fileSize: json.fileSize });
        } else {
          reject(new Error(json.error || `Erreur lors de l'import (${xhr.status})`));
        }
      } catch {
        reject(new Error('Réponse serveur invalide lors du transfert PDF.'));
      }
    };

    xhr.onerror = () => reject(new Error('Échec réseau pendant l’envoi du document PDF.'));

    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function removeExamPrivatePdf(
  examId: string,
  kind: 'subject' | 'correction'
): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db, storage } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');

    const folder = kind === 'subject' ? 'private_subject/subject.pdf' : 'confidential_correction/correction.pdf';
    try {
      await deleteObject(storageRef(storage, `exams/${uid}/${examId}/${folder}`));
    } catch {
      // ignore if already deleted
    }
    try {
      await sparkDeletePdfChunks(db, examId, kind);
    } catch {
      // ignore
    }

    const fieldUpdate =
      kind === 'subject'
        ? { hasSubjectPdf: false, subjectFileName: '', subjectFileSize: 0 }
        : { hasCorrectionPdf: false, correctionFileName: '', correctionFileSize: 0 };

    await updateDoc(doc(db, 'exams', examId), fieldUpdate);
    return;
  }

  await apiRequest(`/api/exams/${encodeURIComponent(examId)}/pdf/${kind}`, {
    method: 'DELETE',
  });
}

export async function fetchTeacherPrivatePdfBytes(
  examId: string,
  kind: 'subject' | 'correction'
): Promise<Uint8Array> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db, storage } = getFirebaseServices();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Non connecté.');
    const folder = kind === 'subject' ? 'private_subject/subject.pdf' : 'confidential_correction/correction.pdf';
    try {
      const bytes = await getBytes(storageRef(storage, `exams/${uid}/${examId}/${folder}`));
      return new Uint8Array(bytes);
    } catch {
      return sparkReadPdfChunks(db, examId, kind);
    }
  }

  const base = getApiBaseUrl();
  const token = getStoredTeacherToken();
  const resp = await fetch(`${base}/api/exams/${encodeURIComponent(examId)}/teacher-pdf/${kind}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    throw new Error('Impossible de charger le document PDF privé.');
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

export interface PublishExamResponse {
  examId: string;
  examCode: string;
  accessCode: string | null;
  accessCodePreviewHint?: string;
  status: ExamStatus;
}

export async function publishExam(
  examId: string,
  regenerateCode = false
): Promise<PublishExamResponse> {
  if (getActiveBackendMode() === 'firebase') {
    const { auth, db, functions } = getFirebaseServices();
    try {
      const fn = httpsCallable<{ examId: string; regenerateCode: boolean }, PublishExamResponse>(
        functions,
        'publishExamWithAccessCode'
      );
      const res = await fn({ examId, regenerateCode });
      return res.data;
    } catch (err) {
      if (isCloudFunctionUnavailableError(err) && auth.currentUser) {
        return sparkPublishExam(db, auth.currentUser.uid, examId, regenerateCode);
      }
      throw err;
    }
  }

  return apiRequest<PublishExamResponse>(`/api/exams/${encodeURIComponent(examId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ regenerateCode }),
  });
}

export async function updateExamStatus(examId: string, status: ExamStatus): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    const { db } = getFirebaseServices();
    await updateDoc(doc(db, 'exams', examId), {
      status,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  await apiRequest(`/api/exams/${encodeURIComponent(examId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function deleteExamWithIdentityCheck(
  examId: string,
  password: string
): Promise<void> {
  if (getActiveBackendMode() === 'firebase') {
    await confirmTeacherIdentity(password);
    const { db } = getFirebaseServices();
    await deleteDoc(doc(db, 'exams', examId));
    return;
  }

  await apiRequest(`/api/exams/${encodeURIComponent(examId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}
