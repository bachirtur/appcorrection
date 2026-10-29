export type SchoolLevel =
  | 'primaire'
  | 'college'
  | 'lycee'
  | 'superieur'
  | 'formation_pro';

export type ExamStatus = 'draft' | 'published' | 'closed' | 'archived';

export type GradingMode =
  | 'mode_a_auto'
  | 'mode_b_assisted'
  | 'mode_c_manual';

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'mcq_single'
  | 'mcq_multiple'
  | 'true_false'
  | 'numeric'
  | 'math_formula'
  | 'table'
  | 'code'
  | 'structured'
  | 'attachment';

export type CodeLanguage =
  | 'python'
  | 'javascript'
  | 'sql'
  | 'c'
  | 'html'
  | 'pseudocode';

export type AppreciationLabel =
  | 'Excellent'
  | 'Bien'
  | 'Assez bien'
  | 'Passable'
  | 'Insuffisant';

export interface TeacherProfile {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  institution?: string;
  defaultSubject?: string;
  retentionDays: number;
  acceptedTerms: boolean;
  acceptedTermsAt: string;
  createdAt: string;
  role: 'teacher';
}

export interface QuestionOption {
  id: string;
  label: string;
}

export interface StructuredSectionDef {
  id: string;
  label: string;
  placeholder?: string;
}

export interface TableTemplateDef {
  headers: string[];
  rows: string[][];
  editableMask?: boolean[][];
}

export interface RubricCriterion {
  id: string;
  description: string;
  points: number;
  keywords?: string[];
}

/**
 * Vue publique de la question transmise à l'élève pendant l'épreuve.
 * NE CONTIENT JAMAIS la réponse attendue ni les éléments secrets du barème.
 */
export interface StudentQuestionView {
  id: string;
  number: number;
  exerciseTitle: string;
  prompt: string;
  type: QuestionType;
  maxPoints: number;
  gradingMode: GradingMode;
  options?: QuestionOption[];
  unit?: string;
  requireUnit?: boolean;
  codeLanguage?: CodeLanguage;
  starterCode?: string;
  tableTemplate?: TableTemplateDef;
  structuredSections?: StructuredSectionDef[];
  allowAttachment?: boolean;
}

/**
 * Données confidentielles du barème et du corrigé (stockées séparément côté serveur).
 * JAMAIS envoyées au navigateur de l'élève pendant l'examen.
 */
export interface QuestionRubricSecret {
  questionId: string;
  expectedAnswer: string;
  acceptedAlternatives: string[];
  caseSensitive?: boolean;
  correctOptionIds?: string[];
  expectedBoolean?: boolean;
  numericValue?: number;
  numericTolerance?: number;
  expectedUnit?: string;
  expectedTable?: string[][];
  criteria: RubricCriterion[];
  enableIndicativeAiAssist?: boolean;
  pedagogicalExplanation?: string;
}

export interface FullQuestionEditorItem extends StudentQuestionView {
  rubric: QuestionRubricSecret;
}

export interface Exam {
  id: string;
  examCode: string;
  teacherId: string;
  title: string;
  subject: string;
  level: SchoolLevel;
  className: string;
  description: string;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  maxScore: number;
  language: string;
  maxAttempts: number;
  allowModifyBeforeSubmit: boolean;
  requireStudentEmail: boolean;
  allowSubjectDownload: boolean;
  showScoreToStudent: boolean;
  showExpectedAnswersToStudent: boolean;
  autoSaveIntervalSeconds: number;
  enableIntegrityMonitoring: boolean;
  defaultGradingMode: GradingMode;
  maxPdfSizeMb: number;
  hasSubjectPdf: boolean;
  subjectFileName?: string;
  subjectFileSize?: number;
  hasCorrectionPdf: boolean;
  correctionFileName?: string;
  correctionFileSize?: number;
  questions: StudentQuestionView[];
  status: ExamStatus;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamWithSecrets extends Exam {
  rubrics: Record<string, QuestionRubricSecret>;
  accessCodePreviewHint?: string;
}

export interface AttachmentPayload {
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  uploadedAt: string;
}

export interface StudentAnswerValue {
  text?: string;
  selectedOptionIds?: string[];
  booleanValue?: boolean | null;
  numericInput?: string;
  unitInput?: string;
  formula?: string;
  code?: string;
  tableValues?: string[][];
  structuredValues?: Record<string, string>;
  attachment?: AttachmentPayload;
  lockedByStudent?: boolean;
  updatedAt?: string;
}

export type IntegrityEventType =
  | 'tab_hidden'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'copy_paste_attempt';

export interface IntegrityEvent {
  id: string;
  type: IntegrityEventType;
  timestamp: string;
  details: string;
}

export interface StudentIdentity {
  firstName: string;
  lastName: string;
  email?: string;
  className: string;
}

export interface ExamSessionInfo {
  sessionId: string;
  sessionToken: string;
  examId: string;
  examCode: string;
  title: string;
  subject: string;
  level: SchoolLevel;
  className: string;
  description: string;
  durationMinutes: number;
  maxScore: number;
  language: string;
  allowModifyBeforeSubmit: boolean;
  allowSubjectDownload: boolean;
  autoSaveIntervalSeconds: boolean | number;
  enableIntegrityMonitoring: boolean;
  hasSubjectPdf: boolean;
  subjectFileName?: string;
  questionCount: number;
  questions: StudentQuestionView[];
  student: StudentIdentity;
  attemptNumber: number;
  status: 'authorized_waiting' | 'in_progress' | 'submitted';
  startedAt?: string;
  deadlineAt?: string;
  serverNow: string;
  remainingSeconds: number;
  revision: number;
  savedAnswers: Record<string, StudentAnswerValue>;
  integrityEvents: IntegrityEvent[];
  submissionId?: string;
}

export type QuestionCorrectionState =
  | 'auto_graded'
  | 'assisted_indicative'
  | 'manual_pending'
  | 'validated';

export interface QuestionGradeResult {
  questionId: string;
  pointsObtained: number;
  maxPoints: number;
  state: QuestionCorrectionState;
  comment: string;
  matchedCriteriaIds?: string[];
  isIndicativeAi?: boolean;
  expectedAnswerDisplay?: string;
}

export interface AuditLogEntry {
  id: string;
  submissionId: string;
  examId: string;
  teacherId: string;
  action: 'grade_modified_after_validation' | 'grade_validated' | 'email_resent' | 'submission_locked';
  questionId?: string;
  previousScoreOn20?: number;
  newScoreOn20?: number;
  previousPoints?: number;
  newPoints?: number;
  reason: string;
  timestamp: string;
}

export interface EmailNotificationStatus {
  status: 'pending' | 'sent' | 'logged_no_smtp' | 'failed';
  sentAt?: string;
  recipient?: string;
  subject?: string;
  error?: string;
  attempts: number;
}

export interface Submission {
  id: string;
  sessionId: string;
  examId: string;
  examCode: string;
  examTitle: string;
  subject: string;
  level: SchoolLevel;
  examMaxScore: number;
  teacherId: string;
  student: StudentIdentity;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string;
  durationSeconds: number;
  autoSubmitted: boolean;
  locked: boolean;
  answers: Record<string, StudentAnswerValue>;
  questionsSnapshot: StudentQuestionView[];
  questionGrades: Record<string, QuestionGradeResult>;
  rawPointsObtained: number;
  rawPointsMax: number;
  finalScoreOutOfMax: number;
  normalizedScoreOn20: number;
  percentage: number;
  appreciation: AppreciationLabel;
  generalComment: string;
  gradingStatus: 'auto_graded' | 'pending_review' | 'validated';
  showScoreToStudent: boolean;
  showExpectedAnswersToStudent: boolean;
  validatedAt?: string;
  validatedBy?: string;
  emailNotification: EmailNotificationStatus;
  integrityEvents: IntegrityEvent[];
  auditTrail: AuditLogEntry[];
}

export interface StudentSubmissionReceipt {
  submissionId: string;
  examCode: string;
  examTitle: string;
  subject: string;
  student: StudentIdentity;
  startedAt: string;
  submittedAt: string;
  durationSeconds: number;
  autoSubmitted: boolean;
  gradingStatus: 'auto_graded' | 'pending_review' | 'validated';
  canViewScore: boolean;
  canViewExpectedAnswers: boolean;
  examMaxScore: number;
  rawPointsObtained?: number;
  rawPointsMax?: number;
  finalScoreOutOfMax?: number;
  normalizedScoreOn20?: number;
  percentage?: number;
  appreciation?: AppreciationLabel;
  generalComment?: string;
  questions: StudentQuestionView[];
  answers: Record<string, StudentAnswerValue>;
  questionGrades?: Record<string, QuestionGradeResult>;
}

export interface DashboardMetrics {
  totalExams: number;
  publishedExams: number;
  activeExamsNow: number;
  finishedExams: number;
  totalSubmissions: number;
  globalAverageOn20: number | null;
  passRatePercent: number | null;
  examAverages: {
    examId: string;
    examCode: string;
    title: string;
    subject: string;
    className: string;
    submissionCount: number;
    averageOn20: number | null;
    passRatePercent: number | null;
  }[];
  recentSubmissions: Submission[];
}
