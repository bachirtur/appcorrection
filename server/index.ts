import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrivateVaultStore } from './store';
import {
  computeStudentFingerprint,
  generateExamPublicId,
  generateSecureReadableCode,
  generateSubmissionPublicId,
  hashPasswordOrCode,
  signToken,
  verifyPasswordOrCode,
  verifyToken,
} from './crypto';
import { dispatchTeacherSubmissionEmail } from './mailer';
import {
  evaluateFullSubmission,
  recalculateSummaryFromQuestionGrades,
  round2,
} from '../src/services/grading';
import {
  AuditLogEntry,
  DashboardMetrics,
  Exam,
  FullQuestionEditorItem,
  IntegrityEvent,
  QuestionGradeResult,
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentQuestionView,
  StudentSubmissionReceipt,
  Submission,
  TeacherProfile,
} from '../src/types';

declare global {
  namespace Express {
    interface Request {
      teacherId?: string;
    }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // Plafond serveur absolu : 25 Mo
  },
});

function sanitizeTeacherProfile(record: any): TeacherProfile {
  return {
    uid: record.uid,
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    emailVerified: Boolean(record.emailVerified),
    institution: record.institution || '',
    defaultSubject: record.defaultSubject || '',
    retentionDays: Number(record.retentionDays || 365),
    acceptedTerms: Boolean(record.acceptedTerms),
    acceptedTermsAt: record.acceptedTermsAt,
    createdAt: record.createdAt,
    role: 'teacher',
  };
}

function splitEditorQuestions(items: FullQuestionEditorItem[] | undefined): {
  publicQuestions: StudentQuestionView[];
  rubrics: Record<string, QuestionRubricSecret>;
} {
  const publicQuestions: StudentQuestionView[] = [];
  const rubrics: Record<string, QuestionRubricSecret> = {};

  for (const item of items || []) {
    const { rubric, ...publicPart } = item as FullQuestionEditorItem;
    publicQuestions.push(publicPart);
    if (rubric) {
      rubrics[item.id] = {
        ...rubric,
        questionId: item.id,
      };
    }
  }
  return { publicQuestions, rubrics };
}

function buildStudentReceipt(sub: Submission): StudentSubmissionReceipt {
  const canViewScore =
    Boolean(sub.showScoreToStudent) &&
    (sub.gradingStatus === 'auto_graded' || sub.gradingStatus === 'validated');
  const canViewExpectedAnswers = canViewScore && Boolean(sub.showExpectedAnswersToStudent);

  let sanitizedGrades: Record<string, QuestionGradeResult> | undefined;
  if (canViewScore) {
    sanitizedGrades = {};
    for (const [qid, g] of Object.entries(sub.questionGrades || {})) {
      sanitizedGrades[qid] = {
        questionId: qid,
        pointsObtained: g.pointsObtained,
        maxPoints: g.maxPoints,
        state: g.state,
        comment: g.comment,
        expectedAnswerDisplay: canViewExpectedAnswers ? g.expectedAnswerDisplay : undefined,
      };
    }
  }

  return {
    submissionId: sub.id,
    examCode: sub.examCode,
    examTitle: sub.examTitle,
    subject: sub.subject,
    student: sub.student,
    startedAt: sub.startedAt,
    submittedAt: sub.submittedAt,
    durationSeconds: sub.durationSeconds,
    autoSubmitted: sub.autoSubmitted,
    gradingStatus: sub.gradingStatus,
    canViewScore,
    canViewExpectedAnswers,
    examMaxScore: sub.examMaxScore,
    rawPointsObtained: canViewScore ? sub.rawPointsObtained : undefined,
    rawPointsMax: canViewScore ? sub.rawPointsMax : undefined,
    finalScoreOutOfMax: canViewScore ? sub.finalScoreOutOfMax : undefined,
    normalizedScoreOn20: canViewScore ? sub.normalizedScoreOn20 : undefined,
    percentage: canViewScore ? sub.percentage : undefined,
    appreciation: canViewScore ? sub.appreciation : undefined,
    generalComment: canViewScore ? sub.generalComment : undefined,
    questions: sub.questionsSnapshot,
    answers: sub.answers,
    questionGrades: sanitizedGrades,
  };
}

export function createApp(customDataDir?: string) {
  const store = new PrivateVaultStore(customDataDir);
  const app = express();

  // Protection anti-abus / limitation de débit par IP en mémoire
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function rateLimit(maxReqs: number, windowMs: number) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${req.path}:${ip}`;
      const now = Date.now();
      const bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        next();
        return;
      }
      bucket.count += 1;
      if (bucket.count > maxReqs) {
        res.status(429).json({
          error: 'Trop de tentatives rapprochées. Veuillez patienter quelques instants avant de réessayer.',
        });
        return;
      }
      next();
    };
  }

  app.use(cors());
  app.use(express.json({ limit: '8mb' }));

  // En-têtes de sécurité HTTP
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Middleware d'authentification stricte Professeur
  function requireTeacherAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const payload = verifyToken(token, 'teacher');
    if (!payload || !store.data.teachers[payload.sub]) {
      res.status(401).json({ error: 'Session professeur expirée ou non authentifiée.' });
      return;
    }
    req.teacherId = payload.sub;
    next();
  }

  // --------------------------------------------------------------------------
  // Santé et diagnostic de configuration (aucun secret exposé)
  // --------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    const smtpConfigured = Boolean(
      process.env.RESEND_API_KEY ||
        (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    );
    res.json({
      status: 'ok',
      service: 'EduExam Secure Backend',
      firebaseProjectLinked: 'appcorrection',
      emailProviderConfigured: smtpConfigured,
      serverTime: new Date().toISOString(),
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4.1 : Authentification et sécurité du compte professeur
  // --------------------------------------------------------------------------
  app.post('/api/auth/register', rateLimit(15, 60_000), (req, res) => {
    const { firstName, lastName, email, password, confirmPassword, acceptedTerms, institution } =
      req.body || {};

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'Tous les champs obligatoires doivent être renseignés.' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Veuillez saisir une adresse e-mail professionnelle valide.' });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Le mot de passe et sa confirmation ne correspondent pas.' });
      return;
    }

    if (
      String(password).length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      res.status(400).json({
        error:
          'Le mot de passe doit contenir au moins 8 caractères, dont une majuscule, une minuscule et un chiffre.',
      });
      return;
    }

    if (acceptedTerms !== true) {
      res.status(400).json({
        error:
          'Vous devez accepter les conditions d’utilisation et la politique de confidentialité.',
      });
      return;
    }

    const existing = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);
    if (existing) {
      res.status(409).json({
        error: 'Impossible de finaliser l’inscription avec ces informations. Si vous possédez déjà un compte, connectez-vous.',
      });
      return;
    }

    const uid = `tch_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const { hash, salt } = hashPasswordOrCode(password, false);
    const verificationCode = generateSecureReadableCode(2, 3);
    const nowIso = new Date().toISOString();

    const record = {
      uid,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: cleanEmail,
      emailVerified: false,
      institution: institution ? String(institution).trim() : '',
      defaultSubject: '',
      retentionDays: 365,
      acceptedTerms: true,
      acceptedTermsAt: nowIso,
      createdAt: nowIso,
      role: 'teacher' as const,
      passwordHash: hash,
      passwordSalt: salt,
      emailVerificationCode: verificationCode,
      failedLoginCount: 0,
    };

    store.data.teachers[uid] = record;
    store.persist();

    const token = signToken({
      kind: 'teacher',
      sub: uid,
      exp: Date.now() + 8 * 3600 * 1000,
    });

    res.status(201).json({
      token,
      teacher: sanitizeTeacherProfile(record),
      verificationCodePreview: verificationCode,
    });
  });

  app.post('/api/auth/login', rateLimit(20, 60_000), (req, res) => {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) {
      res.status(400).json({ error: 'Veuillez renseigner votre adresse e-mail et votre mot de passe.' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const teacher = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);

    const genericAuthErr = 'Identifiants de connexion incorrects.';
    if (!teacher) {
      res.status(401).json({ error: genericAuthErr });
      return;
    }

    if (teacher.lockedUntilMs && Date.now() < teacher.lockedUntilMs) {
      const waitMin = Math.ceil((teacher.lockedUntilMs - Date.now()) / 60_000);
      res.status(423).json({
        error: `Compte temporairement protégé suite à plusieurs échecs. Réessayez dans ${waitMin} min.`,
      });
      return;
    }

    const ok = verifyPasswordOrCode(password, teacher.passwordHash, teacher.passwordSalt, false);
    if (!ok) {
      teacher.failedLoginCount = (teacher.failedLoginCount || 0) + 1;
      if (teacher.failedLoginCount >= 5) {
        teacher.lockedUntilMs = Date.now() + 10 * 60 * 1000;
      }
      store.persist();
      res.status(401).json({ error: genericAuthErr });
      return;
    }

    teacher.failedLoginCount = 0;
    teacher.lockedUntilMs = undefined;
    store.persist();

    const token = signToken({
      kind: 'teacher',
      sub: teacher.uid,
      exp: Date.now() + 8 * 3600 * 1000,
    });

    res.json({
      token,
      teacher: sanitizeTeacherProfile(teacher),
    });
  });

  app.get('/api/auth/me', requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId!];
    res.json({
      teacher: sanitizeTeacherProfile(teacher),
      verificationCodePreview: teacher.emailVerified ? undefined : teacher.emailVerificationCode,
    });
  });

  app.post('/api/auth/verify-email', requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId!];
    const { code } = req.body || {};
    if (teacher.emailVerified) {
      res.json({ teacher: sanitizeTeacherProfile(teacher) });
      return;
    }
    if (!code || String(code).trim().toUpperCase() !== teacher.emailVerificationCode) {
      res.status(400).json({ error: 'Code de vérification invalide.' });
      return;
    }
    teacher.emailVerified = true;
    teacher.emailVerificationCode = undefined;
    store.persist();
    res.json({ teacher: sanitizeTeacherProfile(teacher) });
  });

  app.post('/api/auth/reauthenticate', requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId!];
    const { password } = req.body || {};
    if (!password || !verifyPasswordOrCode(password, teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect. Identité non confirmée.' });
      return;
    }
    res.json({ verified: true, verifiedAt: new Date().toISOString() });
  });

  app.put('/api/auth/profile', requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId!];
    const { firstName, lastName, institution, defaultSubject, retentionDays } = req.body || {};
    if (firstName?.trim()) teacher.firstName = String(firstName).trim();
    if (lastName?.trim()) teacher.lastName = String(lastName).trim();
    if (institution !== undefined) teacher.institution = String(institution).trim();
    if (defaultSubject !== undefined) teacher.defaultSubject = String(defaultSubject).trim();
    if (retentionDays !== undefined) {
      const days = Number(retentionDays);
      if (Number.isFinite(days) && days >= 7 && days <= 1825) {
        teacher.retentionDays = Math.round(days);
      }
    }
    store.persist();
    res.json({ teacher: sanitizeTeacherProfile(teacher) });
  });

  app.post('/api/auth/change-password', requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId!];
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !verifyPasswordOrCode(currentPassword, teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({ error: 'Votre mot de passe actuel est incorrect.' });
      return;
    }
    if (
      !newPassword ||
      String(newPassword).length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      res.status(400).json({
        error: 'Le nouveau mot de passe doit contenir au moins 8 caractères (majuscule, minuscule, chiffre).',
      });
      return;
    }
    const { hash, salt } = hashPasswordOrCode(newPassword, false);
    teacher.passwordHash = hash;
    teacher.passwordSalt = salt;
    store.persist();
    res.json({ updated: true });
  });

  app.post('/api/auth/reset-password-request', rateLimit(10, 60_000), (req, res) => {
    const { email } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const teacher = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);
    let devResetToken: string | undefined;
    if (teacher) {
      devResetToken = signToken({
        kind: 'password_reset',
        sub: teacher.uid,
        exp: Date.now() + 30 * 60 * 1000,
      });
    }
    // Message identique que le compte existe ou non (protection anti-énumération)
    res.json({
      message:
        'Si un compte professionnel correspond à cette adresse, les instructions de réinitialisation ont été générées.',
      resetTokenPreview: !process.env.RESEND_API_KEY && !process.env.SMTP_HOST ? devResetToken : undefined,
    });
  });

  app.post('/api/auth/reset-password-confirm', rateLimit(10, 60_000), (req, res) => {
    const { resetToken, newPassword } = req.body || {};
    const payload = verifyToken(resetToken, 'password_reset');
    if (!payload || !store.data.teachers[payload.sub]) {
      res.status(400).json({ error: 'Jeton de réinitialisation invalide ou expiré.' });
      return;
    }
    if (
      !newPassword ||
      String(newPassword).length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre.',
      });
      return;
    }
    const teacher = store.data.teachers[payload.sub];
    const { hash, salt } = hashPasswordOrCode(newPassword, false);
    teacher.passwordHash = hash;
    teacher.passwordSalt = salt;
    teacher.failedLoginCount = 0;
    teacher.lockedUntilMs = undefined;
    store.persist();
    res.json({ reset: true });
  });

  // --------------------------------------------------------------------------
  // SECTION 4.2 : Tableau de bord Professeur (données réelles isolées)
  // --------------------------------------------------------------------------
  app.get('/api/teacher/dashboard', requireTeacherAuth, (req, res) => {
    const uid = req.teacherId!;
    const now = Date.now();
    const myExams = Object.values(store.data.exams)
      .filter((e) => e.teacherId === uid)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const mySubmissions = Object.values(store.data.submissions)
      .filter((s) => s.teacherId === uid)
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));

    let publishedCount = 0;
    let activeNowCount = 0;
    let finishedCount = 0;

    for (const ex of myExams) {
      const sMs = Date.parse(ex.startAt);
      const eMs = Date.parse(ex.endAt);
      if (ex.status === 'published') {
        publishedCount += 1;
        if ((!Number.isFinite(sMs) || now >= sMs) && (!Number.isFinite(eMs) || now <= eMs)) {
          activeNowCount += 1;
        } else if (Number.isFinite(eMs) && now > eMs) {
          finishedCount += 1;
        }
      } else if (ex.status === 'closed' || ex.status === 'archived') {
        finishedCount += 1;
      }
    }

    const gradedSubs = mySubmissions.filter(
      (s) => s.gradingStatus === 'auto_graded' || s.gradingStatus === 'validated'
    );
    const globalAverageOn20 =
      gradedSubs.length > 0
        ? round2(gradedSubs.reduce((acc, s) => acc + s.normalizedScoreOn20, 0) / gradedSubs.length)
        : null;
    const passRatePercent =
      gradedSubs.length > 0
        ? round2((gradedSubs.filter((s) => s.normalizedScoreOn20 >= 10).length / gradedSubs.length) * 100)
        : null;

    const examAverages = myExams.map((ex) => {
      const subs = mySubmissions.filter((s) => s.examId === ex.id);
      const graded = subs.filter((s) => s.gradingStatus === 'auto_graded' || s.gradingStatus === 'validated');
      const avg =
        graded.length > 0
          ? round2(graded.reduce((a, b) => a + b.normalizedScoreOn20, 0) / graded.length)
          : null;
      const pass =
        graded.length > 0
          ? round2((graded.filter((s) => s.normalizedScoreOn20 >= 10).length / graded.length) * 100)
          : null;
      return {
        examId: ex.id,
        examCode: ex.examCode,
        title: ex.title,
        subject: ex.subject,
        className: ex.className,
        submissionCount: subs.length,
        averageOn20: avg,
        passRatePercent: pass,
      };
    });

    const metrics: DashboardMetrics = {
      totalExams: myExams.length,
      publishedExams: publishedCount,
      activeExamsNow: activeNowCount,
      finishedExams: finishedCount,
      totalSubmissions: mySubmissions.length,
      globalAverageOn20,
      passRatePercent,
      examAverages,
      recentSubmissions: mySubmissions.slice(0, 8),
    };

    res.json(metrics);
  });

  // --------------------------------------------------------------------------
  // SECTION 5 : Gestion des examens, import PDF privé et barème (Modes A/B/C)
  // --------------------------------------------------------------------------
  app.get('/api/exams', requireTeacherAuth, (req, res) => {
    const uid = req.teacherId!;
    const exams = Object.values(store.data.exams)
      .filter((e) => e.teacherId === uid)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    res.json({ exams });
  });

  app.post('/api/exams', requireTeacherAuth, (req, res) => {
    const uid = req.teacherId!;
    const body = req.body || {};

    if (!body.title?.trim() || !body.subject?.trim() || !body.className?.trim()) {
      res.status(400).json({ error: 'Titre, matière et classe sont obligatoires.' });
      return;
    }

    const examId = `exam_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const examCode = generateExamPublicId();
    const nowIso = new Date().toISOString();

    const { publicQuestions, rubrics } = splitEditorQuestions(body.editorQuestions || []);

    const exam: Exam = {
      id: examId,
      examCode,
      teacherId: uid,
      title: String(body.title).trim(),
      subject: String(body.subject).trim(),
      level: body.level || 'lycee',
      className: String(body.className).trim(),
      description: String(body.description || '').trim(),
      durationMinutes: Math.max(5, Math.min(480, Number(body.durationMinutes || 60))),
      startAt: body.startAt || nowIso,
      endAt: body.endAt || new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      maxScore: Math.max(1, Number(body.maxScore || 20)),
      language: body.language || 'fr',
      maxAttempts: Math.max(1, Math.min(10, Number(body.maxAttempts || 1))),
      allowModifyBeforeSubmit: body.allowModifyBeforeSubmit !== false,
      requireStudentEmail: Boolean(body.requireStudentEmail),
      allowSubjectDownload: body.allowSubjectDownload !== false,
      showScoreToStudent: body.showScoreToStudent !== false,
      showExpectedAnswersToStudent: Boolean(body.showExpectedAnswersToStudent),
      autoSaveIntervalSeconds: Math.max(10, Math.min(300, Number(body.autoSaveIntervalSeconds || 20))),
      enableIntegrityMonitoring: body.enableIntegrityMonitoring !== false,
      defaultGradingMode: body.defaultGradingMode || 'mode_a_auto',
      maxPdfSizeMb: Math.max(1, Math.min(25, Number(body.maxPdfSizeMb || 15))),
      hasSubjectPdf: false,
      hasCorrectionPdf: false,
      questions: publicQuestions,
      status: 'draft',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    store.data.exams[examId] = exam;
    store.data.examSecrets[examId] = {
      examId,
      teacherId: uid,
      rubrics: body.rubrics || rubrics,
    };
    store.persist();

    res.status(201).json({
      exam: {
        ...exam,
        rubrics: store.data.examSecrets[examId].rubrics,
      },
    });
  });

  app.get('/api/exams/:examId', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit aux examens d’un autre professeur.' });
      return;
    }
    const secret = store.data.examSecrets[exam.id];
    res.json({
      exam: {
        ...exam,
        rubrics: secret?.rubrics || {},
        accessCodePreviewHint: secret?.accessCodePreviewHint,
      },
    });
  });

  app.put('/api/exams/:examId', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit aux examens d’un autre professeur.' });
      return;
    }

    const body = req.body || {};
    const nowIso = new Date().toISOString();

    if (body.title !== undefined) exam.title = String(body.title).trim();
    if (body.subject !== undefined) exam.subject = String(body.subject).trim();
    if (body.level !== undefined) exam.level = body.level;
    if (body.className !== undefined) exam.className = String(body.className).trim();
    if (body.description !== undefined) exam.description = String(body.description).trim();
    if (body.durationMinutes !== undefined) {
      exam.durationMinutes = Math.max(5, Math.min(480, Number(body.durationMinutes)));
    }
    if (body.startAt !== undefined) exam.startAt = body.startAt;
    if (body.endAt !== undefined) {
      exam.endAt = body.endAt;
      exam.expiresAt = body.endAt;
    }
    if (body.maxScore !== undefined) exam.maxScore = Math.max(1, Number(body.maxScore));
    if (body.language !== undefined) exam.language = body.language;
    if (body.maxAttempts !== undefined) {
      exam.maxAttempts = Math.max(1, Math.min(10, Number(body.maxAttempts)));
    }
    if (body.allowModifyBeforeSubmit !== undefined) {
      exam.allowModifyBeforeSubmit = Boolean(body.allowModifyBeforeSubmit);
    }
    if (body.requireStudentEmail !== undefined) {
      exam.requireStudentEmail = Boolean(body.requireStudentEmail);
    }
    if (body.allowSubjectDownload !== undefined) {
      exam.allowSubjectDownload = Boolean(body.allowSubjectDownload);
    }
    if (body.showScoreToStudent !== undefined) {
      exam.showScoreToStudent = Boolean(body.showScoreToStudent);
    }
    if (body.showExpectedAnswersToStudent !== undefined) {
      exam.showExpectedAnswersToStudent = Boolean(body.showExpectedAnswersToStudent);
    }
    if (body.autoSaveIntervalSeconds !== undefined) {
      exam.autoSaveIntervalSeconds = Math.max(10, Math.min(300, Number(body.autoSaveIntervalSeconds)));
    }
    if (body.enableIntegrityMonitoring !== undefined) {
      exam.enableIntegrityMonitoring = Boolean(body.enableIntegrityMonitoring);
    }
    if (body.defaultGradingMode !== undefined) {
      exam.defaultGradingMode = body.defaultGradingMode;
    }
    if (body.maxPdfSizeMb !== undefined) {
      exam.maxPdfSizeMb = Math.max(1, Math.min(25, Number(body.maxPdfSizeMb)));
    }

    const secret =
      store.data.examSecrets[exam.id] ||
      (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });

    if (Array.isArray(body.editorQuestions)) {
      const { publicQuestions, rubrics } = splitEditorQuestions(body.editorQuestions);
      exam.questions = publicQuestions;
      secret.rubrics = rubrics;
    } else {
      if (Array.isArray(body.questions)) {
        exam.questions = body.questions;
      }
      if (body.rubrics && typeof body.rubrics === 'object') {
        secret.rubrics = body.rubrics;
      }
    }

    exam.updatedAt = nowIso;
    store.persist();

    res.json({
      exam: {
        ...exam,
        rubrics: secret.rubrics,
        accessCodePreviewHint: secret.accessCodePreviewHint,
      },
    });
  });

  // Import sécurisé du sujet PDF ou de la correction PDF (hors dossier public)
  app.post(
    '/api/exams/:examId/upload-pdf',
    requireTeacherAuth,
    upload.single('file'),
    (req, res) => {
      const exam = store.data.exams[req.params.examId];
      if (!exam) {
        res.status(404).json({ error: 'Examen introuvable.' });
        return;
      }
      if (exam.teacherId !== req.teacherId) {
        res.status(403).json({ error: 'Accès refusé.' });
        return;
      }

      const kind = req.body?.kind === 'correction' ? 'correction' : 'subject';
      const file = req.file;
      if (!file || !file.buffer) {
        res.status(400).json({ error: 'Aucun fichier PDF reçu.' });
        return;
      }

      const maxBytes = (exam.maxPdfSizeMb || 15) * 1024 * 1024;
      if (file.size > maxBytes) {
        res.status(413).json({
          error: `Le fichier dépasse la taille maximale configurée (${exam.maxPdfSizeMb} Mo).`,
        });
        return;
      }

      // Vérification stricte de la signature binaire PDF (%PDF-)
      const magicHeader = file.buffer.subarray(0, 5).toString('ascii');
      if (file.mimetype !== 'application/pdf' || magicHeader !== '%PDF-') {
        res.status(400).json({
          error: 'Format invalide : seuls les véritables documents PDF (%PDF-) sont acceptés.',
        });
        return;
      }

      const storedName = store.savePrivatePdf(kind, exam.id, file.buffer);
      const secret =
        store.data.examSecrets[exam.id] ||
        (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });

      if (kind === 'subject') {
        exam.hasSubjectPdf = true;
        exam.subjectFileName = file.originalname || 'Sujet.pdf';
        exam.subjectFileSize = file.size;
        secret.subjectPrivateFile = storedName;
      } else {
        exam.hasCorrectionPdf = true;
        exam.correctionFileName = file.originalname || 'Correction_Officielle.pdf';
        exam.correctionFileSize = file.size;
        secret.correctionPrivateFile = storedName;
      }

      exam.updatedAt = new Date().toISOString();
      store.persist();

      res.json({
        uploaded: true,
        kind,
        fileName: kind === 'subject' ? exam.subjectFileName : exam.correctionFileName,
        fileSize: file.size,
      });
    }
  );

  app.delete('/api/exams/:examId/pdf/:kind', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }
    const kind = req.params.kind === 'correction' ? 'correction' : 'subject';
    const secret = store.data.examSecrets[exam.id];

    if (kind === 'subject') {
      store.deletePrivatePdf('subject', secret?.subjectPrivateFile);
      if (secret) secret.subjectPrivateFile = undefined;
      exam.hasSubjectPdf = false;
      exam.subjectFileName = undefined;
      exam.subjectFileSize = undefined;
    } else {
      store.deletePrivatePdf('correction', secret?.correctionPrivateFile);
      if (secret) secret.correctionPrivateFile = undefined;
      exam.hasCorrectionPdf = false;
      exam.correctionFileName = undefined;
      exam.correctionFileSize = undefined;
    }
    exam.updatedAt = new Date().toISOString();
    store.persist();
    res.json({ deleted: true, kind });
  });

  // Lecture privée du sujet ou du corrigé réservée EXCLUSIVEMENT au professeur propriétaire
  app.get('/api/exams/:examId/teacher-pdf/:kind', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit aux documents d’un autre professeur.' });
      return;
    }
    const kind = req.params.kind === 'correction' ? 'correction' : 'subject';
    const secret = store.data.examSecrets[exam.id];
    const privateFile =
      kind === 'subject' ? secret?.subjectPrivateFile : secret?.correctionPrivateFile;

    if (!privateFile) {
      res.status(404).json({ error: 'Document PDF non importé.' });
      return;
    }
    const buf = store.readPrivatePdf(kind, privateFile);
    if (!buf) {
      res.status(404).json({ error: 'Fichier introuvable dans le coffre privé.' });
      return;
    }

    const displayName =
      (kind === 'subject' ? exam.subjectFileName : exam.correctionFileName) || `${kind}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(displayName)}"`);
    res.send(buf);
  });

  // Étape 5 : Publication & génération cryptographique du code d'accès
  app.post('/api/exams/:examId/publish', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }

    const { regenerateCode } = req.body || {};
    const secret =
      store.data.examSecrets[exam.id] ||
      (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });

    let plainAccessCode: string | null = null;
    if (!secret.accessCodeHash || regenerateCode) {
      plainAccessCode = generateSecureReadableCode(3, 4);
      const hashed = hashPasswordOrCode(plainAccessCode, true);
      secret.accessCodeHash = hashed.hash;
      secret.accessCodeSalt = hashed.salt;
      secret.accessCodePreviewHint = `${plainAccessCode.slice(0, 4)}-****-${plainAccessCode.slice(-2)}`;
    }

    const nowIso = new Date().toISOString();
    exam.status = 'published';
    exam.publishedAt = exam.publishedAt || nowIso;
    exam.expiresAt = exam.endAt;
    exam.updatedAt = nowIso;
    store.persist();

    res.json({
      examId: exam.id,
      examCode: exam.examCode,
      accessCode: plainAccessCode,
      accessCodePreviewHint: secret.accessCodePreviewHint,
      status: exam.status,
      publishedAt: exam.publishedAt,
    });
  });

  app.post('/api/exams/:examId/status', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }
    const { status } = req.body || {};
    if (!['draft', 'published', 'closed', 'archived'].includes(status)) {
      res.status(400).json({ error: 'État invalide.' });
      return;
    }
    exam.status = status;
    exam.updatedAt = new Date().toISOString();
    store.persist();
    res.json({ exam });
  });

  app.delete('/api/exams/:examId', requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen introuvable.' });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }
    const teacher = store.data.teachers[req.teacherId!];
    const password = req.body?.password || req.headers['x-confirm-password'];
    if (!password || !verifyPasswordOrCode(String(password), teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({
        error: 'Confirmation du mot de passe requise pour supprimer définitivement un examen.',
      });
      return;
    }

    const secret = store.data.examSecrets[exam.id];
    store.deletePrivatePdf('subject', secret?.subjectPrivateFile);
    store.deletePrivatePdf('correction', secret?.correctionPrivateFile);
    delete store.data.examSecrets[exam.id];
    delete store.data.exams[exam.id];

    // Nettoyage des sessions et copies rattachées
    for (const [sid, sess] of Object.entries(store.data.examSessions)) {
      if (sess.examId === exam.id) delete store.data.examSessions[sid];
    }
    for (const [subId, sub] of Object.entries(store.data.submissions)) {
      if (sub.examId === exam.id) delete store.data.submissions[subId];
    }

    store.persist();
    res.json({ deleted: true });
  });

  // --------------------------------------------------------------------------
  // SECTION 6, 7, 8, 9, 10 : ESPACE ÉLÈVE (Accès, Sujet temporaire, Chrono, Copie)
  // --------------------------------------------------------------------------
  function buildSessionResponse(session: any, exam: Exam, sessionToken: string) {
    const now = Date.now();
    const endMs = Date.parse(exam.endAt);
    const deadlineMs = session.deadlineAt
      ? Date.parse(session.deadlineAt)
      : Math.min(now + exam.durationMinutes * 60 * 1000, Number.isFinite(endMs) ? endMs : Infinity);

    return {
      sessionId: session.sessionId,
      sessionToken,
      examId: exam.id,
      examCode: exam.examCode,
      title: exam.title,
      subject: exam.subject,
      level: exam.level,
      className: exam.className,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      maxScore: exam.maxScore,
      language: exam.language,
      allowModifyBeforeSubmit: exam.allowModifyBeforeSubmit,
      allowSubjectDownload: exam.allowSubjectDownload,
      autoSaveIntervalSeconds: exam.autoSaveIntervalSeconds,
      enableIntegrityMonitoring: exam.enableIntegrityMonitoring,
      hasSubjectPdf: exam.hasSubjectPdf,
      subjectFileName: exam.subjectFileName || 'Sujet_Examen.pdf',
      questionCount: exam.questions.length,
      questions: session.status === 'in_progress' ? exam.questions : [],
      student: session.student,
      attemptNumber: session.attemptNumber,
      status: session.status,
      startedAt: session.startedAt,
      deadlineAt: session.deadlineAt,
      serverNow: new Date(now).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - now) / 1000)),
      revision: session.revision,
      savedAnswers: session.savedAnswers,
      integrityEvents: session.integrityEvents,
      submissionId: session.submissionId,
    };
  }

  app.post('/api/student/access', rateLimit(25, 60_000), (req, res) => {
    const { firstName, lastName, email, className, examCode, accessCode } = req.body || {};

    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !className?.trim() ||
      !examCode?.trim() ||
      !accessCode?.trim()
    ) {
      res.status(400).json({ error: 'Veuillez renseigner tous les champs d’identification.' });
      return;
    }

    const cleanExamCode = String(examCode).trim().toUpperCase();
    const exam = Object.values(store.data.exams).find((e) => e.examCode === cleanExamCode);

    // Message neutre ne divulguant aucun détail confidentiel sur le professeur ou les brouillons
    const genericDenied =
      'Identifiant de l’examen ou mot de passe incorrect, ou évaluation non accessible.';

    if (!exam || exam.status !== 'published') {
      res.status(403).json({ error: genericDenied });
      return;
    }

    const secret = store.data.examSecrets[exam.id];
    if (
      !secret?.accessCodeHash ||
      !secret?.accessCodeSalt ||
      !verifyPasswordOrCode(String(accessCode), secret.accessCodeHash, secret.accessCodeSalt, true)
    ) {
      res.status(403).json({ error: genericDenied });
      return;
    }

    const now = Date.now();
    const startMs = Date.parse(exam.startAt);
    const endMs = Date.parse(exam.endAt);
    if (Number.isFinite(startMs) && now < startMs) {
      res.status(403).json({
        error: 'Cette évaluation n’est pas encore ouverte. Veuillez réessayer à l’heure prévue.',
      });
      return;
    }
    if (Number.isFinite(endMs) && now > endMs) {
      res.status(403).json({
        error: 'La période d’ouverture de cette évaluation est expirée.',
      });
      return;
    }

    if (exam.requireStudentEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()))) {
      res.status(400).json({ error: 'Une adresse e-mail valide est exigée pour cette évaluation.' });
      return;
    }

    const fp = computeStudentFingerprint(firstName, lastName, className, email);
    const matchingSessions = Object.values(store.data.examSessions).filter(
      (s) => s.examId === exam.id && s.studentFingerprint === fp
    );

    const submittedCount = matchingSessions.filter((s) => s.status === 'submitted').length;
    let activeSession = matchingSessions.find(
      (s) => s.status === 'in_progress' || s.status === 'authorized_waiting'
    );

    if (!activeSession && submittedCount >= exam.maxAttempts) {
      res.status(403).json({
        error: `Vous avez déjà soumis votre copie et atteint le nombre maximal de tentatives autorisées (${exam.maxAttempts}).`,
      });
      return;
    }

    if (!activeSession) {
      const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
      const nowIso = new Date(now).toISOString();
      activeSession = {
        sessionId,
        examId: exam.id,
        examCode: exam.examCode,
        teacherId: exam.teacherId,
        studentFingerprint: fp,
        student: {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: email ? String(email).trim() : '',
          className: String(className).trim(),
        },
        attemptNumber: submittedCount + 1,
        status: 'authorized_waiting',
        revision: 0,
        savedAnswers: {},
        integrityEvents: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.data.examSessions[sessionId] = activeSession;
      store.persist();
    }

    const sessionToken = signToken({
      kind: 'student_session',
      sub: activeSession.sessionId,
      exp: now + Math.max(exam.durationMinutes * 60 * 1000, 6 * 3600 * 1000),
    });

    res.json(buildSessionResponse(activeSession, exam, sessionToken));
  });

  function requireStudentSession(req: Request, res: Response) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const sessionId = req.params.sessionId;
    const payload = verifyToken(token, 'student_session');
    if (!payload || payload.sub !== sessionId) {
      res.status(401).json({ error: 'Jeton de session d’examen invalide ou expiré.' });
      return null;
    }
    const session = store.data.examSessions[sessionId];
    if (!session) {
      res.status(404).json({ error: 'Session d’examen introuvable.' });
      return null;
    }
    const exam = store.data.exams[session.examId];
    if (!exam) {
      res.status(404).json({ error: 'Examen associé introuvable.' });
      return null;
    }
    return { session, exam, token: token! };
  }

  app.get('/api/student/sessions/:sessionId', (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    res.json(buildSessionResponse(ctx.session, ctx.exam, ctx.token));
  });

  app.post('/api/student/sessions/:sessionId/start', (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam, token } = ctx;

    if (session.status === 'submitted') {
      res.status(409).json({ error: 'Cette copie a déjà été soumise définitivement.' });
      return;
    }

    const now = Date.now();
    const endMs = Date.parse(exam.endAt);
    if (Number.isFinite(endMs) && now > endMs) {
      res.status(403).json({ error: 'La période d’ouverture de l’examen est terminée.' });
      return;
    }

    // L'heure de début et la date limite sont scellées côté serveur une seule fois :
    // recharger la page ou changer l'horloge locale ne prolonge JAMAIS le temps !
    if (!session.startedAt) {
      const startedIso = new Date(now).toISOString();
      const computedDeadline = Math.min(
        now + exam.durationMinutes * 60 * 1000,
        Number.isFinite(endMs) ? endMs : now + exam.durationMinutes * 60 * 1000
      );
      session.status = 'in_progress';
      session.startedAt = startedIso;
      session.deadlineAt = new Date(computedDeadline).toISOString();
      session.updatedAt = startedIso;
      store.persist();
    }

    res.json(buildSessionResponse(session, exam, token));
  });

  // Autorisation temporaire (15 min) pour consulter ou télécharger le SUJET PDF uniquement
  app.post('/api/student/sessions/:sessionId/subject-token', (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { exam, session } = ctx;
    if (!exam.hasSubjectPdf) {
      res.status(404).json({ error: 'Aucun sujet PDF n’est attaché à cet examen.' });
      return;
    }

    const pdfToken = signToken({
      kind: 'pdf_access',
      sub: session.sessionId,
      scope: `subject:${exam.id}`,
      exp: Date.now() + 15 * 60 * 1000,
    });

    res.json({
      viewUrl: `/api/student/subject-pdf?token=${encodeURIComponent(pdfToken)}`,
      downloadUrl: exam.allowSubjectDownload
        ? `/api/student/subject-pdf?token=${encodeURIComponent(pdfToken)}&download=1`
        : null,
      fileName: exam.subjectFileName || 'Sujet_Examen.pdf',
      allowDownload: exam.allowSubjectDownload,
    });
  });

  app.get('/api/student/subject-pdf', (req, res) => {
    const rawToken = String(req.query.token || '');
    const payload = verifyToken(rawToken, 'pdf_access');
    if (!payload || !payload.scope?.startsWith('subject:')) {
      res.status(403).json({ error: 'Autorisation temporaire invalide ou expirée.' });
      return;
    }
    const examId = payload.scope.slice('subject:'.length);
    const exam = store.data.exams[examId];
    const secret = store.data.examSecrets[examId];
    if (!exam || !secret?.subjectPrivateFile) {
      res.status(404).json({ error: 'Sujet PDF introuvable.' });
      return;
    }

    const wantsDownload = req.query.download === '1';
    if (wantsDownload && !exam.allowSubjectDownload) {
      res.status(403).json({
        error: 'Le téléchargement hors ligne du sujet n’est pas autorisé pour cette évaluation.',
      });
      return;
    }

    const buf = store.readPrivatePdf('subject', secret.subjectPrivateFile);
    if (!buf) {
      res.status(404).json({ error: 'Fichier introuvable.' });
      return;
    }

    const fileName = exam.subjectFileName || 'Sujet_Examen.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader(
      'Content-Disposition',
      `${wantsDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(fileName)}"`
    );
    res.send(buf);
  });

  // Blocage explicite et journalisé de toute tentative élève vers un chemin de correction
  app.get('/api/student/correction-pdf', (_req, res) => {
    res.status(403).json({
      error: 'Accès strictement interdit : la correction officielle est confidentielle.',
    });
  });

  // Sauvegarde automatique périodique sur le serveur
  app.post('/api/student/sessions/:sessionId/autosave', (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam } = ctx;

    if (session.status === 'submitted') {
      res.status(409).json({ error: 'Copie déjà soumise et verrouillée contre toute modification.' });
      return;
    }

    const now = Date.now();
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : Infinity;
    if (now > deadlineMs + 15_000) {
      res.status(410).json({
        error: 'Le temps imparti est écoulé.',
        expired: true,
        remainingSeconds: 0,
      });
      return;
    }

    const { answers, clientRevision, integrityEvents } = req.body || {};
    const conflictDetected =
      clientRevision !== undefined && Number(clientRevision) < session.revision;

    if (answers && typeof answers === 'object') {
      // Si la modification d'une réponse déjà verrouillée est interdite par le professeur, on préserve les réponses verrouillées
      if (!exam.allowModifyBeforeSubmit) {
        const merged: Record<string, StudentAnswerValue> = { ...session.savedAnswers };
        for (const [qid, incomingVal] of Object.entries(answers as Record<string, StudentAnswerValue>)) {
          if (merged[qid]?.lockedByStudent) {
            continue;
          }
          merged[qid] = incomingVal;
        }
        session.savedAnswers = merged;
      } else {
        session.savedAnswers = answers;
      }
    }

    if (Array.isArray(integrityEvents)) {
      session.integrityEvents = integrityEvents.slice(0, 250);
    }

    session.revision += 1;
    session.updatedAt = new Date(now).toISOString();
    store.persist();

    res.json({
      savedAt: session.updatedAt,
      serverNow: session.updatedAt,
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - now) / 1000)),
      revision: session.revision,
      conflictDetected,
    });
  });

  app.post('/api/student/sessions/:sessionId/integrity', (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session } = ctx;
    if (session.status === 'submitted') {
      res.json({ logged: false });
      return;
    }
    const { type, details } = req.body || {};
    const validTypes = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'copy_paste_attempt'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'Type d’événement invalide.' });
      return;
    }
    const ev: IntegrityEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      details: String(details || '').slice(0, 300),
    };
    session.integrityEvents.push(ev);
    store.persist();
    res.json({ logged: true, event: ev });
  });

  // Soumission définitive (idempotente, verrouillée, notée et notifiée par e-mail)
  app.post('/api/student/sessions/:sessionId/submit', async (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam } = ctx;

    // Prévention absolue des doubles soumissions
    if (session.status === 'submitted' && session.submissionId) {
      const existingSub = store.data.submissions[session.submissionId];
      if (existingSub) {
        res.json({
          alreadySubmitted: true,
          receipt: buildStudentReceipt(existingSub),
        });
        return;
      }
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : now;

    // Si soumission tardive au-delà de la tolérance réseau de 45s, utiliser uniquement la dernière sauvegarde serveur valide
    const incomingAnswers = req.body?.answers;
    let finalAnswers: Record<string, StudentAnswerValue> = session.savedAnswers || {};

    if (incomingAnswers && typeof incomingAnswers === 'object' && now <= deadlineMs + 45_000) {
      if (!exam.allowModifyBeforeSubmit) {
        const merged: Record<string, StudentAnswerValue> = { ...session.savedAnswers };
        for (const [qid, val] of Object.entries(incomingAnswers as Record<string, StudentAnswerValue>)) {
          if (!merged[qid]?.lockedByStudent) {
            merged[qid] = val;
          }
        }
        finalAnswers = merged;
      } else {
        finalAnswers = incomingAnswers;
      }
    }

    const incomingEvents = Array.isArray(req.body?.integrityEvents)
      ? (req.body.integrityEvents as IntegrityEvent[]).slice(0, 250)
      : session.integrityEvents;

    const secret = store.data.examSecrets[exam.id];
    const evalSummary = evaluateFullSubmission(
      exam.questions,
      secret?.rubrics || {},
      finalAnswers,
      exam.maxScore
    );

    const startedMs = session.startedAt ? Date.parse(session.startedAt) : now;
    const durationSeconds = Math.max(
      1,
      Math.round((Math.min(now, deadlineMs + 5000) - startedMs) / 1000)
    );

    const submissionId = generateSubmissionPublicId();
    const autoSubmitted = Boolean(req.body?.autoSubmitted || now > deadlineMs);

    const initialAudit: AuditLogEntry = {
      id: crypto.randomUUID(),
      submissionId,
      examId: exam.id,
      teacherId: exam.teacherId,
      action: 'submission_locked',
      reason: autoSubmitted
        ? 'Soumission automatique déclenchée à l’expiration du chronomètre serveur'
        : 'Soumission définitive confirmée par l’élève',
      timestamp: nowIso,
    };

    const submission: Submission = {
      id: submissionId,
      sessionId: session.sessionId,
      examId: exam.id,
      examCode: exam.examCode,
      examTitle: exam.title,
      subject: exam.subject,
      level: exam.level,
      examMaxScore: exam.maxScore,
      teacherId: exam.teacherId,
      student: session.student,
      attemptNumber: session.attemptNumber,
      startedAt: session.startedAt || nowIso,
      submittedAt: nowIso,
      durationSeconds,
      autoSubmitted,
      locked: true,
      answers: finalAnswers,
      questionsSnapshot: exam.questions,
      ...evalSummary,
      generalComment: '',
      showScoreToStudent: exam.showScoreToStudent,
      showExpectedAnswersToStudent: exam.showExpectedAnswersToStudent,
      emailNotification: {
        status: 'pending',
        attempts: 0,
      },
      integrityEvents: incomingEvents,
      auditTrail: [initialAudit],
    };

    session.status = 'submitted';
    session.submittedAt = nowIso;
    session.submissionId = submissionId;
    session.savedAnswers = finalAnswers;
    session.integrityEvents = incomingEvents;
    session.updatedAt = nowIso;

    store.data.submissions[submissionId] = submission;
    store.data.auditLogs.push(initialAudit);
    store.persist();

    // Envoi de la notification par e-mail au professeur propriétaire
    const teacher = store.data.teachers[exam.teacherId];
    if (teacher) {
      const origin = String(req.body?.appOriginUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const secureCopyUrl = `${origin}/#/professeur/copies?submissionId=${encodeURIComponent(submissionId)}`;
      const mailResult = await dispatchTeacherSubmissionEmail({
        teacherEmail: teacher.email,
        teacherEmailVerified: teacher.emailVerified,
        examCode: exam.examCode,
        examTitle: exam.title,
        studentFullName: `${submission.student.firstName} ${submission.student.lastName}`,
        className: submission.student.className,
        submittedAtIso: submission.submittedAt,
        validatedScoreDisplay:
          submission.gradingStatus === 'auto_graded'
            ? `${submission.normalizedScoreOn20}/20 (${submission.percentage}% — ${submission.appreciation})`
            : undefined,
        secureCopyUrl,
      });

      submission.emailNotification = {
        ...mailResult,
        attempts: 1,
      };
      store.data.emailLogs.push({
        id: crypto.randomUUID(),
        teacherId: teacher.uid,
        submissionId,
        recipient: teacher.email,
        subject: mailResult.subject,
        status: mailResult.status,
        error: mailResult.error,
        createdAt: new Date().toISOString(),
      });
      store.persist();
    }

    res.status(201).json({
      alreadySubmitted: false,
      receipt: buildStudentReceipt(submission),
    });
  });

  app.get('/api/student/receipt/:submissionId', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const payload = verifyToken(token, 'student_session');
    const sub = store.data.submissions[req.params.submissionId];

    if (!payload || !sub || sub.sessionId !== payload.sub) {
      res.status(403).json({ error: 'Accès non autorisé à ce résultat.' });
      return;
    }
    res.json({ receipt: buildStudentReceipt(sub) });
  });

  // --------------------------------------------------------------------------
  // SECTION 14 : Gestion des copies, notation, audit et relance e-mail
  // --------------------------------------------------------------------------
  app.get('/api/submissions', requireTeacherAuth, (req, res) => {
    const uid = req.teacherId!;
    let list = Object.values(store.data.submissions).filter((s) => s.teacherId === uid);

    const { examId, className, subject, gradingStatus, minScore, maxScore, fromDate, toDate } =
      req.query;

    if (examId) list = list.filter((s) => s.examId === String(examId));
    if (className) {
      const q = String(className).toLowerCase();
      list = list.filter((s) => s.student.className.toLowerCase().includes(q));
    }
    if (subject) {
      const q = String(subject).toLowerCase();
      list = list.filter((s) => s.subject.toLowerCase().includes(q));
    }
    if (gradingStatus) {
      list = list.filter((s) => s.gradingStatus === String(gradingStatus));
    }
    if (minScore !== undefined && minScore !== '') {
      list = list.filter((s) => s.normalizedScoreOn20 >= Number(minScore));
    }
    if (maxScore !== undefined && maxScore !== '') {
      list = list.filter((s) => s.normalizedScoreOn20 <= Number(maxScore));
    }
    if (fromDate) {
      const fMs = Date.parse(String(fromDate));
      if (Number.isFinite(fMs)) list = list.filter((s) => Date.parse(s.submittedAt) >= fMs);
    }
    if (toDate) {
      const tMs = Date.parse(String(toDate)) + 86399_999;
      if (Number.isFinite(tMs)) list = list.filter((s) => Date.parse(s.submittedAt) <= tMs);
    }

    list.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
    res.json({ submissions: list });
  });

  app.get('/api/submissions/:submissionId', requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: 'Copie introuvable.' });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès strictement interdit aux copies d’un autre professeur.' });
      return;
    }
    const secret = store.data.examSecrets[sub.examId];
    const exam = store.data.exams[sub.examId];
    res.json({
      submission: sub,
      rubrics: secret?.rubrics || {},
      hasCorrectionPdf: Boolean(exam?.hasCorrectionPdf),
      hasSubjectPdf: Boolean(exam?.hasSubjectPdf),
    });
  });

  app.put('/api/submissions/:submissionId/grade', requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: 'Copie introuvable.' });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }

    const {
      questionGrades,
      manualDirectScoreOutOfMax,
      generalComment,
      validateNow,
      showScoreToStudent,
      showExpectedAnswersToStudent,
      auditReason,
    } = req.body || {};

    const wasAlreadyValidated = sub.gradingStatus === 'validated';
    if (wasAlreadyValidated && (!auditReason || String(auditReason).trim().length < 3)) {
      res.status(400).json({
        error:
          'Cette note a déjà été validée : un motif explicite est obligatoire pour toute modification (journal d’audit).',
      });
      return;
    }

    const previousScoreOn20 = sub.normalizedScoreOn20;
    const nowIso = new Date().toISOString();

    if (questionGrades && typeof questionGrades === 'object' && Object.keys(questionGrades).length > 0) {
      const sanitized: Record<string, QuestionGradeResult> = {};
      for (const [qid, g] of Object.entries(questionGrades as Record<string, QuestionGradeResult>)) {
        const clamped = round2(Math.max(0, Math.min(Number(g.maxPoints || 0), Number(g.pointsObtained || 0))));
        sanitized[qid] = {
          ...g,
          pointsObtained: clamped,
          state: validateNow ? 'validated' : g.state,
          isIndicativeAi: validateNow ? false : g.isIndicativeAi,
        };
      }
      sub.questionGrades = sanitized;
      const summary = recalculateSummaryFromQuestionGrades(
        sanitized,
        sub.examMaxScore,
        Boolean(validateNow || wasAlreadyValidated)
      );
      sub.rawPointsObtained = summary.rawPointsObtained;
      sub.rawPointsMax = summary.rawPointsMax;
      sub.finalScoreOutOfMax = summary.finalScoreOutOfMax;
      sub.normalizedScoreOn20 = summary.normalizedScoreOn20;
      sub.percentage = summary.percentage;
      sub.appreciation = summary.appreciation;
      sub.gradingStatus = summary.gradingStatus;
    } else if (manualDirectScoreOutOfMax !== undefined) {
      // Cas d'un sujet PDF libre sans questions structurées (Mode C global)
      const clamped = round2(
        Math.max(0, Math.min(sub.examMaxScore, Number(manualDirectScoreOutOfMax)))
      );
      const ratio = sub.examMaxScore > 0 ? clamped / sub.examMaxScore : 0;
      sub.rawPointsObtained = clamped;
      sub.rawPointsMax = sub.examMaxScore;
      sub.finalScoreOutOfMax = clamped;
      sub.normalizedScoreOn20 = round2(ratio * 20);
      sub.percentage = round2(ratio * 100);
      const summary = recalculateSummaryFromQuestionGrades({}, sub.examMaxScore, Boolean(validateNow));
      sub.appreciation =
        sub.normalizedScoreOn20 >= 16
          ? 'Excellent'
          : sub.normalizedScoreOn20 >= 14
          ? 'Bien'
          : sub.normalizedScoreOn20 >= 12
          ? 'Assez bien'
          : sub.normalizedScoreOn20 >= 10
          ? 'Passable'
          : 'Insuffisant';
      sub.gradingStatus = validateNow || wasAlreadyValidated ? 'validated' : summary.gradingStatus;
    }

    if (generalComment !== undefined) sub.generalComment = String(generalComment);
    if (showScoreToStudent !== undefined) sub.showScoreToStudent = Boolean(showScoreToStudent);
    if (showExpectedAnswersToStudent !== undefined) {
      sub.showExpectedAnswersToStudent = Boolean(showExpectedAnswersToStudent);
    }

    if (validateNow) {
      sub.validatedAt = nowIso;
      sub.validatedBy = req.teacherId;
      sub.gradingStatus = 'validated';
    }

    const auditEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      submissionId: sub.id,
      examId: sub.examId,
      teacherId: req.teacherId!,
      action: wasAlreadyValidated ? 'grade_modified_after_validation' : 'grade_validated',
      previousScoreOn20,
      newScoreOn20: sub.normalizedScoreOn20,
      reason:
        String(auditReason || '').trim() ||
        (validateNow ? 'Validation officielle de la note par le professeur' : 'Enregistrement des points de correction'),
      timestamp: nowIso,
    };

    sub.auditTrail.push(auditEntry);
    store.data.auditLogs.push(auditEntry);
    store.persist();

    res.json({ submission: sub, auditEntry });
  });

  app.post('/api/submissions/:submissionId/resend-email', requireTeacherAuth, async (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: 'Copie introuvable.' });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }
    const teacher = store.data.teachers[req.teacherId!];
    const origin = String(req.body?.appOriginUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const secureCopyUrl = `${origin}/#/professeur/copies?submissionId=${encodeURIComponent(sub.id)}`;

    let pdfBuffer: Buffer | undefined;
    if (req.body?.pdfBase64 && typeof req.body.pdfBase64 === 'string') {
      pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
    }

    const mailRes = await dispatchTeacherSubmissionEmail({
      teacherEmail: teacher.email,
      teacherEmailVerified: teacher.emailVerified,
      examCode: sub.examCode,
      examTitle: sub.examTitle,
      studentFullName: `${sub.student.firstName} ${sub.student.lastName}`,
      className: sub.student.className,
      submittedAtIso: sub.submittedAt,
      validatedScoreDisplay:
        sub.gradingStatus === 'validated' || sub.gradingStatus === 'auto_graded'
          ? `${sub.normalizedScoreOn20}/20 (${sub.percentage}% — ${sub.appreciation})`
          : undefined,
      secureCopyUrl,
      pdfBuffer,
      pdfFileName: `Rapport_Professeur_${sub.id}.pdf`,
    });

    sub.emailNotification = {
      ...mailRes,
      attempts: (sub.emailNotification?.attempts || 0) + 1,
    };

    const auditEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      submissionId: sub.id,
      examId: sub.examId,
      teacherId: req.teacherId!,
      action: 'email_resent',
      reason: `Relance manuelle de la notification (${mailRes.status})`,
      timestamp: new Date().toISOString(),
    };
    sub.auditTrail.push(auditEntry);
    store.data.auditLogs.push(auditEntry);
    store.persist();

    res.json({ emailNotification: sub.emailNotification });
  });

  app.delete('/api/submissions/:submissionId', requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: 'Copie introuvable.' });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: 'Accès interdit.' });
      return;
    }
    delete store.data.submissions[sub.id];
    if (store.data.examSessions[sub.sessionId]) {
      delete store.data.examSessions[sub.sessionId];
    }
    store.persist();
    res.json({ deleted: true });
  });

  app.get('/api/audit-logs', requireTeacherAuth, (req, res) => {
    const logs = store.data.auditLogs
      .filter((l) => l.teacherId === req.teacherId)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    res.json({ auditLogs: logs });
  });

  return { app, store };
}

// Démarrage direct lorsque `tsx server/index.ts` est exécuté
const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.API_HOST || '127.0.0.1';
  const { app } = createApp();
  app.listen(port, host, () => {
    console.log(`[EduExam API] Serveur sécurisé démarré sur http://${host}:${port}`);
  });
}
