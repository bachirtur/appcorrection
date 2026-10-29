export interface QuestionOption {
  id: string;
  label: string;
}

export interface RubricCriterion {
  id: string;
  description: string;
  points: number;
  keywords?: string[];
}

export interface StudentQuestion {
  id: string;
  number: number;
  exerciseTitle: string;
  prompt: string;
  type: string;
  maxPoints: number;
  gradingMode: 'mode_a_auto' | 'mode_b_assisted' | 'mode_c_manual';
  options?: QuestionOption[];
  unit?: string;
  requireUnit?: boolean;
  tableTemplate?: { headers: string[]; rows: string[][]; editableMask?: boolean[][] };
}

export interface QuestionRubric {
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

export interface StudentAnswer {
  text?: string;
  selectedOptionIds?: string[];
  booleanValue?: boolean | null;
  numericInput?: string;
  unitInput?: string;
  formula?: string;
  code?: string;
  tableValues?: string[][];
  structuredValues?: Record<string, string>;
}

export interface QuestionGrade {
  questionId: string;
  pointsObtained: number;
  maxPoints: number;
  state: 'auto_graded' | 'assisted_indicative' | 'manual_pending' | 'validated';
  comment: string;
  matchedCriteriaIds?: string[];
  isIndicativeAi?: boolean;
  expectedAnswerDisplay?: string;
}

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function computeAppreciation(
  scoreOn20: number
): 'Excellent' | 'Bien' | 'Assez bien' | 'Passable' | 'Insuffisant' {
  if (scoreOn20 >= 16) return 'Excellent';
  if (scoreOn20 >= 14) return 'Bien';
  if (scoreOn20 >= 12) return 'Assez bien';
  if (scoreOn20 >= 10) return 'Passable';
  return 'Insuffisant';
}

function normalizeText(input: string, caseSensitive = false): string {
  const t = (input || '').trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLowerCase();
}

function normalizeMath(input: string): string {
  return (input || '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .toLowerCase();
}

function parseNum(raw?: string): number | null {
  if (!raw) return null;
  const c = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!c) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

export function evaluateSubmissionOnServer(
  questions: StudentQuestion[],
  rubrics: Record<string, QuestionRubric>,
  answers: Record<string, StudentAnswer>,
  examMaxScore = 20
) {
  const questionGrades: Record<string, QuestionGrade> = {};
  let rawPointsObtained = 0;
  let rawPointsMax = 0;
  let requiresHuman = false;

  for (const q of questions) {
    const r = rubrics[q.id];
    const a = answers[q.id];
    const maxP = q.maxPoints;
    let grade: QuestionGrade;

    if (q.gradingMode === 'mode_c_manual' || !r) {
      grade = {
        questionId: q.id,
        pointsObtained: 0,
        maxPoints: maxP,
        state: 'manual_pending',
        comment: 'En attente de correction manuelle par le professeur.',
        expectedAnswerDisplay: r?.expectedAnswer || '',
      };
    } else if (q.gradingMode === 'mode_b_assisted') {
      if (r.enableIndicativeAiAssist && r.criteria?.length) {
        const corpus = normalizeText(
          [a?.text, a?.code, a?.formula, ...(a?.structuredValues ? Object.values(a.structuredValues) : [])]
            .filter(Boolean)
            .join(' '),
          false
        );
        let pts = 0;
        const matched: string[] = [];
        for (const c of r.criteria) {
          const kws = (c.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
          if (kws.length > 0 && corpus.length > 0) {
            const count = kws.filter((kw) => corpus.includes(kw)).length;
            if (count >= Math.ceil(kws.length * 0.6)) {
              pts += c.points;
              matched.push(c.id);
            }
          }
        }
        grade = {
          questionId: q.id,
          pointsObtained: round2(Math.min(maxP, Math.max(0, pts))),
          maxPoints: maxP,
          state: 'assisted_indicative',
          isIndicativeAi: true,
          matchedCriteriaIds: matched,
          comment:
            'Pré-évaluation assistée indicative basée sur les critères attendus — validation humaine du professeur requise.',
          expectedAnswerDisplay: r.expectedAnswer || '',
        };
      } else {
        grade = {
          questionId: q.id,
          pointsObtained: 0,
          maxPoints: maxP,
          state: 'manual_pending',
          comment: 'Correction assistée — en attente de validation du professeur.',
          expectedAnswerDisplay: r.expectedAnswer || '',
        };
      }
    } else {
      // Mode A
      switch (q.type) {
        case 'mcq_single': {
          const sel = a?.selectedOptionIds || [];
          const cor = r.correctOptionIds || [];
          const ok = sel.length === 1 && cor.length === 1 && sel[0] === cor[0];
          grade = {
            questionId: q.id,
            pointsObtained: ok ? maxP : 0,
            maxPoints: maxP,
            state: 'auto_graded',
            comment: ok ? r.pedagogicalExplanation || 'Bonne réponse.' : r.pedagogicalExplanation || 'Réponse incorrecte.',
            expectedAnswerDisplay: r.expectedAnswer || '',
          };
          break;
        }
        case 'mcq_multiple': {
          const sel = [...(a?.selectedOptionIds || [])].sort();
          const cor = [...(r.correctOptionIds || [])].sort();
          const ok = sel.length === cor.length && sel.every((v, i) => v === cor[i]);
          grade = {
            questionId: q.id,
            pointsObtained: ok ? maxP : 0,
            maxPoints: maxP,
            state: 'auto_graded',
            comment: ok ? 'Combinaison exacte.' : 'Combinaison incomplète ou erronée.',
            expectedAnswerDisplay: r.expectedAnswer || '',
          };
          break;
        }
        case 'true_false': {
          const ok = (a?.booleanValue === true || a?.booleanValue === false) && a?.booleanValue === r.expectedBoolean;
          grade = {
            questionId: q.id,
            pointsObtained: ok ? maxP : 0,
            maxPoints: maxP,
            state: 'auto_graded',
            comment: ok ? 'Réponse exacte.' : 'Réponse inexacte.',
            expectedAnswerDisplay: r.expectedAnswer || (r.expectedBoolean ? 'Vrai' : 'Faux'),
          };
          break;
        }
        case 'numeric': {
          const pv = parseNum(a?.numericInput);
          const ev = r.numericValue;
          const tol = Math.abs(r.numericTolerance ?? 0);
          if (ev === undefined || ev === null || Number.isNaN(ev)) {
            grade = {
              questionId: q.id,
              pointsObtained: 0,
              maxPoints: maxP,
              state: 'manual_pending',
              comment: 'Valeur cible non configurée — vérification manuelle requise.',
              expectedAnswerDisplay: r.expectedAnswer || '',
            };
          } else if (pv === null || Math.abs(pv - ev) > tol + 1e-9) {
            grade = {
              questionId: q.id,
              pointsObtained: 0,
              maxPoints: maxP,
              state: 'auto_graded',
              comment: 'Valeur absente ou hors tolérance.',
              expectedAnswerDisplay: r.expectedAnswer || String(ev),
            };
          } else if (q.requireUnit && r.expectedUnit?.trim() && normalizeText(a?.unitInput || '') !== normalizeText(r.expectedUnit)) {
            grade = {
              questionId: q.id,
              pointsObtained: round2(maxP * 0.75),
              maxPoints: maxP,
              state: 'auto_graded',
              comment: `Valeur exacte, mais unité incorrecte (attendu : ${r.expectedUnit}).`,
              expectedAnswerDisplay: `${ev} ${r.expectedUnit}`,
            };
          } else {
            grade = {
              questionId: q.id,
              pointsObtained: maxP,
              maxPoints: maxP,
              state: 'auto_graded',
              comment: r.pedagogicalExplanation || 'Valeur numérique exacte.',
              expectedAnswerDisplay: r.expectedAnswer || String(ev),
            };
          }
          break;
        }
        case 'short_text': {
          const cs = Boolean(r.caseSensitive);
          const sv = normalizeText(a?.text || '', cs);
          const cands = [r.expectedAnswer, ...(r.acceptedAlternatives || [])].filter(Boolean).map((x) => normalizeText(x, cs));
          if (!cands.length) {
            grade = {
              questionId: q.id,
              pointsObtained: 0,
              maxPoints: maxP,
              state: 'manual_pending',
              comment: 'Vérification manuelle requise.',
              expectedAnswerDisplay: '',
            };
          } else {
            const ok = sv.length > 0 && cands.includes(sv);
            grade = {
              questionId: q.id,
              pointsObtained: ok ? maxP : 0,
              maxPoints: maxP,
              state: 'auto_graded',
              comment: ok ? 'Réponse exacte.' : 'Réponse différente des réponses acceptées.',
              expectedAnswerDisplay: r.expectedAnswer,
            };
          }
          break;
        }
        case 'math_formula': {
          const se = normalizeMath(a?.formula || '');
          const cands = [r.expectedAnswer, ...(r.acceptedAlternatives || [])].filter(Boolean).map((x) => normalizeMath(x));
          const ok = se.length > 0 && cands.includes(se);
          grade = cands.length
            ? {
                questionId: q.id,
                pointsObtained: ok ? maxP : 0,
                maxPoints: maxP,
                state: 'auto_graded',
                comment: ok ? 'Expression mathématique conforme.' : 'Expression différente de la forme attendue.',
                expectedAnswerDisplay: r.expectedAnswer,
              }
            : {
                questionId: q.id,
                pointsObtained: 0,
                maxPoints: maxP,
                state: 'manual_pending',
                comment: 'Vérification manuelle requise.',
                expectedAnswerDisplay: '',
              };
          break;
        }
        default:
          grade = {
            questionId: q.id,
            pointsObtained: 0,
            maxPoints: maxP,
            state: 'manual_pending',
            comment: 'Question ouverte : nécessite l’évaluation du professeur.',
            expectedAnswerDisplay: r.expectedAnswer || '',
          };
      }
    }

    questionGrades[q.id] = grade;
    rawPointsObtained += grade.pointsObtained;
    rawPointsMax += maxP;
    if (grade.state !== 'auto_graded' && grade.state !== 'validated') {
      requiresHuman = true;
    }
  }

  if (questions.length === 0) {
    requiresHuman = true;
    rawPointsMax = examMaxScore > 0 ? examMaxScore : 20;
  }

  rawPointsObtained = round2(rawPointsObtained);
  rawPointsMax = round2(rawPointsMax);
  const ratio = rawPointsMax > 0 ? rawPointsObtained / rawPointsMax : 0;
  const percentage = round2(ratio * 100);
  const finalScoreOutOfMax = round2(ratio * (examMaxScore > 0 ? examMaxScore : 20));
  const normalizedScoreOn20 = round2(ratio * 20);

  return {
    questionGrades,
    rawPointsObtained,
    rawPointsMax,
    finalScoreOutOfMax,
    normalizedScoreOn20,
    percentage,
    appreciation: computeAppreciation(normalizedScoreOn20),
    gradingStatus: (requiresHuman ? 'pending_review' : 'auto_graded') as 'auto_graded' | 'pending_review' | 'validated',
  };
}
