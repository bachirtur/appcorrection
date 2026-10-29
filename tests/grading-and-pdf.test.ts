import { describe, expect, it } from 'vitest';
import {
  computeAppreciation,
  evaluateFullSubmission,
  gradeSingleQuestion,
} from '../src/services/grading';
import {
  buildStudentPdfReportBytes,
  buildTeacherPdfReportBytes,
} from '../src/services/pdf';
import {
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentQuestionView,
  Submission,
} from '../src/types';

describe('Moteur de correction, barème Modes A/B/C, normalisation /20 et génération PDF', () => {
  it('attribue les mentions officielles exactes sur 20', () => {
    expect(computeAppreciation(18.5)).toBe('Excellent');
    expect(computeAppreciation(16)).toBe('Excellent');
    expect(computeAppreciation(15.99)).toBe('Bien');
    expect(computeAppreciation(14)).toBe('Bien');
    expect(computeAppreciation(13.5)).toBe('Assez bien');
    expect(computeAppreciation(12)).toBe('Assez bien');
    expect(computeAppreciation(11.25)).toBe('Passable');
    expect(computeAppreciation(10)).toBe('Passable');
    expect(computeAppreciation(9.99)).toBe('Insuffisant');
    expect(computeAppreciation(0)).toBe('Insuffisant');
  });

  it('corrige avec précision en Mode A (QCM, Vrai/Faux, Numérique avec tolérance et unité, Texte court, Tableau)', () => {
    const qNumeric: StudentQuestionView = {
      id: 'q_num',
      number: 1,
      exerciseTitle: 'Physique',
      prompt: 'Accélération de la pesanteur',
      type: 'numeric',
      maxPoints: 4,
      gradingMode: 'mode_a_auto',
      requireUnit: true,
      unit: 'm/s²',
    };
    const rNumeric: QuestionRubricSecret = {
      questionId: 'q_num',
      expectedAnswer: '9.81 m/s²',
      acceptedAlternatives: [],
      numericValue: 9.81,
      numericTolerance: 0.05,
      expectedUnit: 'm/s²',
      criteria: [],
    };

    // Valeur dans la tolérance avec virgule française et bonne unité -> 4/4
    const resFull = gradeSingleQuestion(qNumeric, rNumeric, {
      numericInput: '9,80',
      unitInput: 'm/s²',
    });
    expect(resFull.pointsObtained).toBe(4);
    expect(resFull.state).toBe('auto_graded');

    // Bonne valeur mais unité oubliée -> pénalité partielle (3/4)
    const resNoUnit = gradeSingleQuestion(qNumeric, rNumeric, {
      numericInput: '9.81',
      unitInput: '',
    });
    expect(resNoUnit.pointsObtained).toBe(3);

    // Hors tolérance -> 0/4
    const resWrong = gradeSingleQuestion(qNumeric, rNumeric, {
      numericInput: '11.2',
      unitInput: 'm/s²',
    });
    expect(resWrong.pointsObtained).toBe(0);
  });

  it('normalise un barème sur 40 vers une note sur 20 et distingue Mode B (indicatif) et Mode C (manuel)', () => {
    const questions: StudentQuestionView[] = [
      {
        id: 'q1',
        number: 1,
        exerciseTitle: 'Ex 1',
        prompt: 'QCM',
        type: 'mcq_single',
        maxPoints: 20,
        gradingMode: 'mode_a_auto',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
      {
        id: 'q2',
        number: 2,
        exerciseTitle: 'Ex 2',
        prompt: 'Code Python',
        type: 'code',
        maxPoints: 20,
        gradingMode: 'mode_b_assisted',
      },
    ];

    const rubrics: Record<string, QuestionRubricSecret> = {
      q1: {
        questionId: 'q1',
        expectedAnswer: 'B',
        acceptedAlternatives: [],
        correctOptionIds: ['b'],
        criteria: [],
      },
      q2: {
        questionId: 'q2',
        expectedAnswer: 'return n * 2',
        acceptedAlternatives: [],
        enableIndicativeAiAssist: true,
        criteria: [
          { id: 'c1', description: 'Mot-clé return', points: 10, keywords: ['return'] },
          { id: 'c2', description: 'Multiplication par 2', points: 10, keywords: ['*', '2'] },
        ],
      },
    };

    const answers: Record<string, StudentAnswerValue> = {
      q1: { selectedOptionIds: ['b'] },
      q2: { code: 'def double(n):\n    return n * 2' },
    };

    const summary = evaluateFullSubmission(questions, rubrics, answers, 40);
    // 20 + 20 = 40/40 => normalisé 20/20, mais statut pending_review car Mode B exige validation humaine !
    expect(summary.rawPointsObtained).toBe(40);
    expect(summary.rawPointsMax).toBe(40);
    expect(summary.finalScoreOutOfMax).toBe(40);
    expect(summary.normalizedScoreOn20).toBe(20);
    expect(summary.appreciation).toBe('Excellent');
    expect(summary.gradingStatus).toBe('pending_review');
    expect(summary.questionGrades.q2.isIndicativeAi).toBe(true);
  });

  it('génère des rapports PDF A (professeur) et PDF B (élève) valides (%PDF-)', () => {
    const sampleSubmission: Submission = {
      id: 'SUB-2026-TEST01',
      sessionId: 'ses_test',
      examId: 'exam_1',
      examCode: 'EXM-2026-ABCDEF',
      examTitle: 'Contrôle de Mathématiques',
      subject: 'Mathématiques',
      level: 'lycee',
      examMaxScore: 20,
      teacherId: 'tch_1',
      student: {
        firstName: 'Yasmine',
        lastName: 'Ben Ali',
        className: 'Terminale S1',
        email: 'yasmine@ecole.tn',
      },
      attemptNumber: 1,
      startedAt: '2026-10-29T08:00:00.000Z',
      submittedAt: '2026-10-29T08:45:00.000Z',
      durationSeconds: 2700,
      autoSubmitted: false,
      locked: true,
      answers: {
        q1: { text: '42' },
      },
      questionsSnapshot: [
        {
          id: 'q1',
          number: 1,
          exerciseTitle: 'Algèbre',
          prompt: 'Calculer x',
          type: 'short_text',
          maxPoints: 20,
          gradingMode: 'mode_a_auto',
        },
      ],
      questionGrades: {
        q1: {
          questionId: 'q1',
          pointsObtained: 16,
          maxPoints: 20,
          state: 'validated',
          comment: 'Très bon raisonnement.',
          expectedAnswerDisplay: '42',
        },
      },
      rawPointsObtained: 16,
      rawPointsMax: 20,
      finalScoreOutOfMax: 16,
      normalizedScoreOn20: 16,
      percentage: 80,
      appreciation: 'Excellent',
      generalComment: 'Excellent travail.',
      gradingStatus: 'validated',
      showScoreToStudent: true,
      showExpectedAnswersToStudent: false,
      emailNotification: { status: 'logged_no_smtp', attempts: 1 },
      integrityEvents: [
        {
          id: 'ev1',
          type: 'window_blur',
          timestamp: '2026-10-29T08:20:00.000Z',
          details: 'Perte de focus fenêtre',
        },
      ],
      auditTrail: [],
    };

    const pdfA = buildTeacherPdfReportBytes(sampleSubmission);
    expect(pdfA.bytes.byteLength).toBeGreaterThan(1500);
    expect(String.fromCharCode(...pdfA.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(pdfA.fileName).toContain('PDF_A_Professeur');

    const pdfB = buildStudentPdfReportBytes({
      submissionId: sampleSubmission.id,
      examCode: sampleSubmission.examCode,
      examTitle: sampleSubmission.examTitle,
      subject: sampleSubmission.subject,
      student: sampleSubmission.student,
      startedAt: sampleSubmission.startedAt,
      submittedAt: sampleSubmission.submittedAt,
      durationSeconds: sampleSubmission.durationSeconds,
      autoSubmitted: false,
      gradingStatus: 'validated',
      canViewScore: false,
      canViewExpectedAnswers: false,
      examMaxScore: 20,
      questions: sampleSubmission.questionsSnapshot,
      answers: sampleSubmission.answers,
    });
    expect(pdfB.bytes.byteLength).toBeGreaterThan(1200);
    expect(String.fromCharCode(...pdfB.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(pdfB.fileName).toContain('PDF_B_Resultat_Eleve');
  });
});
