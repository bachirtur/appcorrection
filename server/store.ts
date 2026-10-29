import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AuditLogEntry,
  Exam,
  IntegrityEvent,
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentIdentity,
  Submission,
  TeacherProfile,
} from '../src/types';

export interface StoredTeacherRecord extends TeacherProfile {
  passwordHash: string;
  passwordSalt: string;
  emailVerificationCode?: string;
  failedLoginCount: number;
  lockedUntilMs?: number;
}

export interface StoredExamSecret {
  examId: string;
  teacherId: string;
  accessCodeHash?: string;
  accessCodeSalt?: string;
  accessCodePreviewHint?: string;
  rubrics: Record<string, QuestionRubricSecret>;
  subjectPrivateFile?: string;
  correctionPrivateFile?: string;
}

export interface StoredExamSession {
  sessionId: string;
  examId: string;
  examCode: string;
  teacherId: string;
  studentFingerprint: string;
  student: StudentIdentity;
  attemptNumber: number;
  status: 'authorized_waiting' | 'in_progress' | 'submitted';
  startedAt?: string;
  deadlineAt?: string;
  submittedAt?: string;
  submissionId?: string;
  revision: number;
  savedAnswers: Record<string, StudentAnswerValue>;
  integrityEvents: IntegrityEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredEmailLog {
  id: string;
  teacherId: string;
  submissionId: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'logged_no_smtp' | 'failed';
  error?: string;
  createdAt: string;
}

export interface DatabaseState {
  teachers: Record<string, StoredTeacherRecord>;
  exams: Record<string, Exam>;
  examSecrets: Record<string, StoredExamSecret>;
  examSessions: Record<string, StoredExamSession>;
  submissions: Record<string, Submission>;
  auditLogs: AuditLogEntry[];
  emailLogs: StoredEmailLog[];
}

const EMPTY_STATE: DatabaseState = {
  teachers: {},
  exams: {},
  examSecrets: {},
  examSessions: {},
  submissions: {},
  auditLogs: [],
  emailLogs: [],
};

export class PrivateVaultStore {
  public readonly baseDir: string;
  public readonly dbFilePath: string;
  public readonly subjectsDir: string;
  public readonly correctionsDir: string;
  private state: DatabaseState;

  constructor(customBaseDir?: string) {
    const defaultBaseDir = process.env.VERCEL
      ? path.join(os.tmpdir(), 'eduexam-vault')
      : path.resolve(process.cwd(), 'server', '.data');
    this.baseDir = customBaseDir || process.env.EDUEXAM_DATA_DIR || defaultBaseDir;
    this.dbFilePath = path.join(this.baseDir, 'db.json');
    this.subjectsDir = path.join(this.baseDir, 'private_subjects');
    this.correctionsDir = path.join(this.baseDir, 'confidential_corrections');

    fs.mkdirSync(this.subjectsDir, { recursive: true });
    fs.mkdirSync(this.correctionsDir, { recursive: true });

    if (fs.existsSync(this.dbFilePath)) {
      try {
        const raw = fs.readFileSync(this.dbFilePath, 'utf8');
        this.state = { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
      } catch {
        this.state = structuredClone(EMPTY_STATE);
      }
    } else {
      this.state = structuredClone(EMPTY_STATE);
      this.persist();
    }
  }

  public get data(): DatabaseState {
    return this.state;
  }

  public persist(): void {
    const tmpPath = `${this.dbFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.dbFilePath);
  }

  public savePrivatePdf(kind: 'subject' | 'correction', examId: string, buffer: Buffer): string {
    const safeExamId = examId.replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${safeExamId}_${kind}.pdf`;
    const dir = kind === 'subject' ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, fileName);
    fs.writeFileSync(fullPath, buffer);
    return fileName;
  }

  public readPrivatePdf(kind: 'subject' | 'correction', fileName: string): Buffer | null {
    const baseName = path.basename(fileName);
    const dir = kind === 'subject' ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, baseName);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  }

  public deletePrivatePdf(kind: 'subject' | 'correction', fileName?: string): void {
    if (!fileName) return;
    const baseName = path.basename(fileName);
    const dir = kind === 'subject' ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, baseName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}
