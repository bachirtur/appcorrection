import {
  AppreciationLabel,
  QuestionGradeResult,
  QuestionRubricSecret,
  StudentAnswerValue,
  StudentQuestionView,
} from '../types';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeAppreciation(scoreOn20: number): AppreciationLabel {
  if (scoreOn20 >= 16) return 'Excellent';
  if (scoreOn20 >= 14) return 'Bien';
  if (scoreOn20 >= 12) return 'Assez bien';
  if (scoreOn20 >= 10) return 'Passable';
  return 'Insuffisant';
}

export function normalizeText(input: string, caseSensitive = false): string {
  const trimmed = (input || '').trim().replace(/\s+/g, ' ');
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

export function normalizeMathExpression(input: string): string {
  return (input || '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .toLowerCase();
}

export function parseFrenchNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatStudentAnswerSummary(
  question: StudentQuestionView,
  answer: StudentAnswerValue | undefined
): string {
  if (!answer) return '(Aucune réponse fournie)';

  switch (question.type) {
    case 'short_text':
    case 'long_text':
      return answer.text?.trim() ? answer.text.trim() : '(Aucune réponse fournie)';

    case 'mcq_single':
    case 'mcq_multiple': {
      const selected = answer.selectedOptionIds || [];
      if (selected.length === 0) return '(Aucun choix sélectionné)';
      const labels = selected.map((id) => {
        const opt = question.options?.find((o) => o.id === id);
        return opt ? opt.label : id;
      });
      return labels.join(' ; ');
    }

    case 'true_false': {
      if (answer.booleanValue === true) return 'Vrai';
      if (answer.booleanValue === false) return 'Faux';
      return '(Non répondu)';
    }

    case 'numeric': {
      if (!answer.numericInput?.trim()) return '(Aucune valeur saisie)';
      const unitPart = answer.unitInput?.trim() || question.unit || '';
      return unitPart ? `${answer.numericInput.trim()} ${unitPart}` : answer.numericInput.trim();
    }

    case 'math_formula':
      return answer.formula?.trim() || '(Aucune formule saisie)';

    case 'code':
      return answer.code?.trim() || '(Aucun code saisi)';

    case 'table': {
      if (!answer.tableValues || answer.tableValues.length === 0) {
        return '(Tableau non complété)';
      }
      return answer.tableValues
        .map((row) => `[ ${row.map((c) => c || '—').join(' | ')} ]`)
        .join('\n');
    }

    case 'structured': {
      const vals = answer.structuredValues || {};
      const entries = (question.structuredSections || [])
        .map((sec) => `${sec.label}: ${vals[sec.id]?.trim() || '—'}`);
      return entries.length > 0 ? entries.join('\n') : '(Aucune réponse structurée)';
    }

    case 'attachment': {
      if (answer.attachment?.fileName) {
        const note = answer.text?.trim() ? ` — Note : ${answer.text.trim()}` : '';
        return `Fichier joint : ${answer.attachment.fileName} (${Math.round(answer.attachment.size / 1024)} Ko)${note}`;
      }
      return answer.text?.trim() || '(Aucune pièce jointe)';
    }

    default:
      return answer.text?.trim() || '(Aucune réponse)';
  }
}

export function extractFullAnswerTextForAssist(
  question: StudentQuestionView,
  answer: StudentAnswerValue | undefined
): string {
  if (!answer) return '';
  const chunks: string[] = [];
  if (answer.text) chunks.push(answer.text);
  if (answer.code) chunks.push(answer.code);
  if (answer.formula) chunks.push(answer.formula);
  if (answer.structuredValues) {
    chunks.push(...Object.values(answer.structuredValues));
  }
  return chunks.join(' \n ');
}

export function gradeSingleQuestion(
  question: StudentQuestionView,
  rubric: QuestionRubricSecret | undefined,
  answer: StudentAnswerValue | undefined
): QuestionGradeResult {
  const maxPoints = question.maxPoints;

  // Mode C : correction manuelle obligatoire
  if (question.gradingMode === 'mode_c_manual' || !rubric) {
    return {
      questionId: question.id,
      pointsObtained: 0,
      maxPoints,
      state: 'manual_pending',
      comment: 'En attente de correction manuelle par le professeur.',
      expectedAnswerDisplay: rubric?.expectedAnswer || '',
    };
  }

  // Mode B : correction assistée par grille de critères
  if (question.gradingMode === 'mode_b_assisted') {
    if (rubric.enableIndicativeAiAssist && rubric.criteria && rubric.criteria.length > 0) {
      const textCorpus = normalizeText(extractFullAnswerTextForAssist(question, answer), false);
      let suggestedPoints = 0;
      const matchedIds: string[] = [];

      for (const crit of rubric.criteria) {
        const keywords = (crit.keywords || [])
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        if (keywords.length > 0 && textCorpus.length > 0) {
          const matchedCount = keywords.filter((kw) => textCorpus.includes(kw)).length;
          if (matchedCount >= Math.ceil(keywords.length * 0.6)) {
            suggestedPoints += crit.points;
            matchedIds.push(crit.id);
          }
        }
      }

      const capped = round2(Math.min(maxPoints, Math.max(0, suggestedPoints)));
      return {
        questionId: question.id,
        pointsObtained: capped,
        maxPoints,
        state: 'assisted_indicative',
        isIndicativeAi: true,
        matchedCriteriaIds: matchedIds,
        comment:
          'Pré-évaluation assistée indicative basée sur les critères attendus — validation humaine du professeur requise.',
        expectedAnswerDisplay: rubric.expectedAnswer || '',
      };
    }

    return {
      questionId: question.id,
      pointsObtained: 0,
      maxPoints,
      state: 'manual_pending',
      comment: 'Correction assistée par grille de critères — en attente de validation du professeur.',
      expectedAnswerDisplay: rubric.expectedAnswer || '',
    };
  }

  // Mode A : correction automatique pour les types objectifs définis avec précision
  switch (question.type) {
    case 'mcq_single': {
      const selected = answer?.selectedOptionIds || [];
      const correct = rubric.correctOptionIds || [];
      const isCorrect = selected.length === 1 && correct.length === 1 && selected[0] === correct[0];
      return {
        questionId: question.id,
        pointsObtained: isCorrect ? maxPoints : 0,
        maxPoints,
        state: 'auto_graded',
        comment: isCorrect
          ? rubric.pedagogicalExplanation || 'Bonne réponse.'
          : rubric.pedagogicalExplanation || 'Réponse incorrecte.',
        expectedAnswerDisplay:
          rubric.expectedAnswer ||
          correct
            .map((id) => question.options?.find((o) => o.id === id)?.label || id)
            .join(', '),
      };
    }

    case 'mcq_multiple': {
      const selected = [...(answer?.selectedOptionIds || [])].sort();
      const correct = [...(rubric.correctOptionIds || [])].sort();
      const exactMatch =
        selected.length === correct.length &&
        selected.every((val, idx) => val === correct[idx]);

      return {
        questionId: question.id,
        pointsObtained: exactMatch ? maxPoints : 0,
        maxPoints,
        state: 'auto_graded',
        comment: exactMatch
          ? rubric.pedagogicalExplanation || 'Combinaison exacte.'
          : rubric.pedagogicalExplanation || 'Combinaison incomplète ou erronée.',
        expectedAnswerDisplay:
          rubric.expectedAnswer ||
          correct
            .map((id) => question.options?.find((o) => o.id === id)?.label || id)
            .join(' ; '),
      };
    }

    case 'true_false': {
      const hasAnswered = answer?.booleanValue === true || answer?.booleanValue === false;
      const isCorrect = hasAnswered && answer?.booleanValue === rubric.expectedBoolean;
      return {
        questionId: question.id,
        pointsObtained: isCorrect ? maxPoints : 0,
        maxPoints,
        state: 'auto_graded',
        comment: isCorrect
          ? rubric.pedagogicalExplanation || 'Réponse exacte.'
          : rubric.pedagogicalExplanation || 'Réponse inexacte.',
        expectedAnswerDisplay:
          rubric.expectedAnswer || (rubric.expectedBoolean ? 'Vrai' : 'Faux'),
      };
    }

    case 'numeric': {
      const parsedStudent = parseFrenchNumber(answer?.numericInput);
      const expectedVal = rubric.numericValue;
      const tolerance = Math.abs(rubric.numericTolerance ?? 0);

      if (expectedVal === undefined || expectedVal === null || Number.isNaN(expectedVal)) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'manual_pending',
          comment: 'Valeur cible non configurée — vérification manuelle requise.',
          expectedAnswerDisplay: rubric.expectedAnswer || '',
        };
      }

      if (parsedStudent === null) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'auto_graded',
          comment: 'Aucune valeur numérique valide fournie.',
          expectedAnswerDisplay:
            rubric.expectedAnswer ||
            `${expectedVal}${rubric.expectedUnit ? ' ' + rubric.expectedUnit : ''}`,
        };
      }

      const valueMatches = Math.abs(parsedStudent - expectedVal) <= tolerance + 1e-9;
      if (!valueMatches) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'auto_graded',
          comment: rubric.pedagogicalExplanation || 'Valeur hors tolérance acceptée.',
          expectedAnswerDisplay:
            rubric.expectedAnswer ||
            `${expectedVal}${tolerance > 0 ? ` (±${tolerance})` : ''}${
              rubric.expectedUnit ? ' ' + rubric.expectedUnit : ''
            }`,
        };
      }

      if (question.requireUnit && rubric.expectedUnit?.trim()) {
        const studentUnit = normalizeText(answer?.unitInput || '', false);
        const targetUnit = normalizeText(rubric.expectedUnit, false);
        if (studentUnit !== targetUnit) {
          const partial = round2(maxPoints * 0.75);
          return {
            questionId: question.id,
            pointsObtained: partial,
            maxPoints,
            state: 'auto_graded',
            comment: `Valeur numérique exacte, mais unité absente ou incorrecte (attendu : ${rubric.expectedUnit}).`,
            expectedAnswerDisplay: `${expectedVal} ${rubric.expectedUnit}`,
          };
        }
      }

      return {
        questionId: question.id,
        pointsObtained: maxPoints,
        maxPoints,
        state: 'auto_graded',
        comment: rubric.pedagogicalExplanation || 'Valeur numérique exacte.',
        expectedAnswerDisplay:
          rubric.expectedAnswer ||
          `${expectedVal}${rubric.expectedUnit ? ' ' + rubric.expectedUnit : ''}`,
      };
    }

    case 'short_text': {
      const caseSens = Boolean(rubric.caseSensitive);
      const studentVal = normalizeText(answer?.text || '', caseSens);
      const candidates = [rubric.expectedAnswer, ...(rubric.acceptedAlternatives || [])]
        .filter(Boolean)
        .map((c) => normalizeText(c, caseSens));

      if (candidates.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'manual_pending',
          comment: 'Aucune réponse de référence paramétrée — vérification par le professeur.',
          expectedAnswerDisplay: '',
        };
      }

      const matched = studentVal.length > 0 && candidates.includes(studentVal);
      return {
        questionId: question.id,
        pointsObtained: matched ? maxPoints : 0,
        maxPoints,
        state: 'auto_graded',
        comment: matched
          ? rubric.pedagogicalExplanation || 'Réponse exacte.'
          : rubric.pedagogicalExplanation || 'Réponse différente des réponses acceptées.',
        expectedAnswerDisplay: rubric.expectedAnswer,
      };
    }

    case 'math_formula': {
      const studentExpr = normalizeMathExpression(answer?.formula || '');
      const candidates = [rubric.expectedAnswer, ...(rubric.acceptedAlternatives || [])]
        .filter(Boolean)
        .map((c) => normalizeMathExpression(c));

      if (candidates.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'manual_pending',
          comment: 'Vérification mathématique manuelle requise.',
          expectedAnswerDisplay: rubric.expectedAnswer || '',
        };
      }

      const matched = studentExpr.length > 0 && candidates.includes(studentExpr);
      return {
        questionId: question.id,
        pointsObtained: matched ? maxPoints : 0,
        maxPoints,
        state: 'auto_graded',
        comment: matched
          ? rubric.pedagogicalExplanation || 'Expression mathématique conforme.'
          : 'Expression différente de la forme attendue (peut être vérifiée par le professeur si équivalente).',
        expectedAnswerDisplay: rubric.expectedAnswer,
      };
    }

    case 'table': {
      const expectedGrid = rubric.expectedTable;
      const studentGrid = answer?.tableValues;
      if (!expectedGrid || expectedGrid.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: 'manual_pending',
          comment: 'Tableau en attente de correction par le professeur.',
          expectedAnswerDisplay: rubric.expectedAnswer || '',
        };
      }

      let totalCells = 0;
      let correctCells = 0;
      expectedGrid.forEach((row, rIdx) => {
        row.forEach((expectedCell, cIdx) => {
          const templateCell = question.tableTemplate?.rows?.[rIdx]?.[cIdx] ?? '';
          const isEditable =
            question.tableTemplate?.editableMask?.[rIdx]?.[cIdx] ?? templateCell.trim() === '';
          if (isEditable && expectedCell.trim() !== '') {
            totalCells += 1;
            const got = normalizeText(studentGrid?.[rIdx]?.[cIdx] || '', false);
            if (got === normalizeText(expectedCell, false)) {
              correctCells += 1;
            }
          }
        });
      });

      const points =
        totalCells > 0 ? round2((correctCells / totalCells) * maxPoints) : 0;
      return {
        questionId: question.id,
        pointsObtained: points,
        maxPoints,
        state: 'auto_graded',
        comment: `${correctCells}/${totalCells} cellules attendues exactes.`,
        expectedAnswerDisplay: rubric.expectedAnswer || 'Voir grille du tableau corrigé.',
      };
    }

    // Pour les rédactions longues, programmes ou pièces jointes même si Mode A a été laissé :
    // refus honnête d'une pseudo-correction automatique trompeuse -> renvoi en revue enseignant.
    default:
      return {
        questionId: question.id,
        pointsObtained: 0,
        maxPoints,
        state: 'manual_pending',
        comment:
          'Question ouverte / complexe : nécessite l’évaluation pédagogique du professeur.',
        expectedAnswerDisplay: rubric.expectedAnswer || '',
      };
  }
}

export interface ComputedSubmissionSummary {
  questionGrades: Record<string, QuestionGradeResult>;
  rawPointsObtained: number;
  rawPointsMax: number;
  finalScoreOutOfMax: number;
  normalizedScoreOn20: number;
  percentage: number;
  appreciation: AppreciationLabel;
  gradingStatus: 'auto_graded' | 'pending_review' | 'validated';
}

export function evaluateFullSubmission(
  questions: StudentQuestionView[],
  rubrics: Record<string, QuestionRubricSecret>,
  answers: Record<string, StudentAnswerValue>,
  examMaxScore = 20
): ComputedSubmissionSummary {
  const questionGrades: Record<string, QuestionGradeResult> = {};
  let rawPointsObtained = 0;
  let rawPointsMax = 0;
  let requiresHumanReview = false;

  for (const q of questions) {
    const res = gradeSingleQuestion(q, rubrics[q.id], answers[q.id]);
    questionGrades[q.id] = res;
    rawPointsObtained += res.pointsObtained;
    rawPointsMax += q.maxPoints;
    if (res.state !== 'auto_graded' && res.state !== 'validated') {
      requiresHumanReview = true;
    }
  }

  // Si aucune question structurée n'a été créée (sujet 100% libre sur PDF), correction manuelle
  if (questions.length === 0) {
    requiresHumanReview = true;
    rawPointsMax = examMaxScore > 0 ? examMaxScore : 20;
  }

  rawPointsObtained = round2(rawPointsObtained);
  rawPointsMax = round2(rawPointsMax);

  const ratio = rawPointsMax > 0 ? rawPointsObtained / rawPointsMax : 0;
  const percentage = round2(ratio * 100);
  const finalScoreOutOfMax = round2(ratio * (examMaxScore > 0 ? examMaxScore : 20));
  const normalizedScoreOn20 = round2(ratio * 20);
  const appreciation = computeAppreciation(normalizedScoreOn20);

  return {
    questionGrades,
    rawPointsObtained,
    rawPointsMax,
    finalScoreOutOfMax,
    normalizedScoreOn20,
    percentage,
    appreciation,
    gradingStatus: requiresHumanReview ? 'pending_review' : 'auto_graded',
  };
}

export function recalculateSummaryFromQuestionGrades(
  questionGrades: Record<string, QuestionGradeResult>,
  examMaxScore = 20,
  forceValidated = false
): Omit<ComputedSubmissionSummary, 'questionGrades'> {
  const entries = Object.values(questionGrades);
  let rawPointsObtained = 0;
  let rawPointsMax = 0;
  let hasPending = false;

  for (const g of entries) {
    rawPointsObtained += g.pointsObtained;
    rawPointsMax += g.maxPoints;
    if (!forceValidated && g.state !== 'auto_graded' && g.state !== 'validated') {
      hasPending = true;
    }
  }

  if (entries.length === 0) {
    rawPointsMax = examMaxScore > 0 ? examMaxScore : 20;
  }

  rawPointsObtained = round2(Math.max(0, Math.min(rawPointsMax, rawPointsObtained)));
  rawPointsMax = round2(rawPointsMax);

  const ratio = rawPointsMax > 0 ? rawPointsObtained / rawPointsMax : 0;
  const percentage = round2(ratio * 100);
  const finalScoreOutOfMax = round2(ratio * (examMaxScore > 0 ? examMaxScore : 20));
  const normalizedScoreOn20 = round2(ratio * 20);
  const appreciation = computeAppreciation(normalizedScoreOn20);

  return {
    rawPointsObtained,
    rawPointsMax,
    finalScoreOutOfMax,
    normalizedScoreOn20,
    percentage,
    appreciation,
    gradingStatus: forceValidated
      ? 'validated'
      : hasPending
      ? 'pending_review'
      : 'auto_graded',
  };
}
