import React from 'react';
import {
  AlertTriangle,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CodeLanguage,
  FullQuestionEditorItem,
  GradingMode,
  QuestionType,
  RubricCriterion,
} from '../types';

interface QuestionBuilderProps {
  questions: FullQuestionEditorItem[];
  defaultGradingMode: GradingMode;
  onChange: (next: FullQuestionEditorItem[]) => void;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq_single: 'QCM (choix unique)',
  mcq_multiple: 'QCM (choix multiples)',
  true_false: 'Vrai / Faux',
  numeric: 'Réponse numérique (tolérance & unité)',
  short_text: 'Texte court',
  long_text: 'Texte long / Rédaction',
  math_formula: 'Formule mathématique (KaTeX)',
  code: 'Programme informatique (Python, SQL, JS, C...)',
  table: 'Tableau à compléter',
  structured: 'Réponse structurée multi-parties',
  attachment: 'Pièce jointe / Image / Schéma',
};

export function createEmptyQuestion(
  number: number,
  defaultMode: GradingMode
): FullQuestionEditorItem {
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    number,
    exerciseTitle: 'Exercice 1',
    prompt: '',
    type: 'mcq_single',
    maxPoints: 2,
    gradingMode: defaultMode,
    options: [
      { id: 'opt_a', label: 'Proposition A' },
      { id: 'opt_b', label: 'Proposition B' },
      { id: 'opt_c', label: 'Proposition C' },
    ],
    rubric: {
      questionId: id,
      expectedAnswer: '',
      acceptedAlternatives: [],
      correctOptionIds: ['opt_a'],
      expectedBoolean: true,
      numericValue: 0,
      numericTolerance: 0,
      expectedUnit: '',
      criteria: [],
      enableIndicativeAiAssist: false,
      pedagogicalExplanation: '',
    },
  };
}

export const QuestionBuilder: React.FC<QuestionBuilderProps> = ({
  questions,
  defaultGradingMode,
  onChange,
}) => {
  const addQuestion = (presetType?: QuestionType) => {
    const q = createEmptyQuestion(questions.length + 1, defaultGradingMode);
    if (presetType) {
      q.type = presetType;
      if (['long_text', 'code', 'structured', 'attachment'].includes(presetType) && q.gradingMode === 'mode_a_auto') {
        q.gradingMode = 'mode_b_assisted';
      }
      if (presetType === 'code') {
        q.codeLanguage = 'python';
        q.starterCode = 'def solution(x):\n    # Complétez votre fonction\n    return x\n';
      }
      if (presetType === 'table') {
        q.tableTemplate = {
          headers: ['Grandeur', 'Valeur mesurée', 'Unité'],
          rows: [
            ['Tension U', '', 'V'],
            ['Intensité I', '', 'A'],
          ],
        };
        q.rubric.expectedTable = [
          ['Tension U', '12', 'V'],
          ['Intensité I', '0.5', 'A'],
        ];
      }
      if (presetType === 'structured') {
        q.structuredSections = [
          { id: 'hypothese', label: '1. Hypothèse / Données' },
          { id: 'raisonnement', label: '2. Développement / Calcul' },
          { id: 'conclusion', label: '3. Conclusion' },
        ];
      }
    }
    onChange([...questions, q]);
  };

  const updateQuestion = (index: number, patch: Partial<FullQuestionEditorItem>) => {
    const next = [...questions];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const updateRubric = (
    index: number,
    rubricPatch: Partial<FullQuestionEditorItem['rubric']>
  ) => {
    const next = [...questions];
    next[index] = {
      ...next[index],
      rubric: {
        ...next[index].rubric,
        ...rubricPatch,
      },
    };
    onChange(next);
  };

  const removeQuestion = (index: number) => {
    const next = questions
      .filter((_, i) => i !== index)
      .map((q, idx) => ({ ...q, number: idx + 1 }));
    onChange(next);
  };

  const addSampleMultidisciplinarySet = () => {
    const q1Id = `q_${Date.now()}_1`;
    const q2Id = `q_${Date.now()}_2`;
    const q3Id = `q_${Date.now()}_3`;
    const sample: FullQuestionEditorItem[] = [
      {
        id: q1Id,
        number: questions.length + 1,
        exerciseTitle: 'Exercice 1 — Question objective',
        prompt: 'Quelle est la dérivée de la fonction f(x) = 3x² + 5x - 2 sur ℝ ?',
        type: 'mcq_single',
        maxPoints: 4,
        gradingMode: 'mode_a_auto',
        options: [
          { id: 'a', label: "f'(x) = 6x + 5" },
          { id: 'b', label: "f'(x) = 3x + 5" },
          { id: 'c', label: "f'(x) = 6x² + 5" },
        ],
        rubric: {
          questionId: q1Id,
          expectedAnswer: "f'(x) = 6x + 5",
          acceptedAlternatives: [],
          correctOptionIds: ['a'],
          criteria: [],
          pedagogicalExplanation: 'La dérivée de ax² + bx + c est 2ax + b, soit 6x + 5.',
        },
      },
      {
        id: q2Id,
        number: questions.length + 2,
        exerciseTitle: 'Exercice 1 — Application scientifique',
        prompt: 'Calculez l’énergie cinétique (en J) d’un solide de masse m = 2 kg animé d’une vitesse v = 5 m/s.',
        type: 'numeric',
        maxPoints: 6,
        gradingMode: 'mode_a_auto',
        unit: 'J',
        requireUnit: true,
        rubric: {
          questionId: q2Id,
          expectedAnswer: '25 J',
          acceptedAlternatives: [],
          numericValue: 25,
          numericTolerance: 0.1,
          expectedUnit: 'J',
          criteria: [],
          pedagogicalExplanation: 'Ec = 1/2 × m × v² = 0,5 × 2 × 25 = 25 J.',
        },
      },
      {
        id: q3Id,
        number: questions.length + 3,
        exerciseTitle: 'Exercice 2 — Algorithmique & Raisonnement',
        prompt: 'Écrivez une fonction Python `est_pair(n)` qui renvoie True si l’entier n est pair et False sinon, puis expliquez brièvement le principe.',
        type: 'code',
        codeLanguage: 'python',
        starterCode: 'def est_pair(n):\n    ',
        maxPoints: 10,
        gradingMode: 'mode_b_assisted',
        rubric: {
          questionId: q3Id,
          expectedAnswer: 'def est_pair(n):\n    return n % 2 == 0',
          acceptedAlternatives: [],
          enableIndicativeAiAssist: true,
          criteria: [
            {
              id: 'c1',
              description: 'Utilisation de l’opérateur modulo (%) par 2',
              points: 6,
              keywords: ['%', '2'],
            },
            {
              id: 'c2',
              description: 'Instruction return renvoyant un booléen',
              points: 4,
              keywords: ['return', '=='],
            },
          ],
          pedagogicalExplanation: 'Un entier est pair si et seulement si le reste de sa division euclidienne par 2 vaut 0.',
        },
      },
    ];
    onChange([...questions, ...sample]);
  };

  return (
    <div className="space-y-5">
      {/* Barre d'ajout rapide */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => addQuestion('mcq_single')}
            className="btn-primary text-xs py-2"
          >
            <Plus className="h-4 w-4" /> Ajouter une question
          </button>
          <button
            type="button"
            onClick={() => addQuestion('numeric')}
            className="btn-secondary text-xs py-2"
          >
            + Numérique
          </button>
          <button
            type="button"
            onClick={() => addQuestion('long_text')}
            className="btn-secondary text-xs py-2"
          >
            + Rédaction
          </button>
          <button
            type="button"
            onClick={() => addQuestion('code')}
            className="btn-secondary text-xs py-2"
          >
            + Code
          </button>
          <button
            type="button"
            onClick={() => addQuestion('math_formula')}
            className="btn-secondary text-xs py-2"
          >
            + Formule Maths
          </button>
        </div>

        <button
          type="button"
          onClick={addSampleMultidisciplinarySet}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
        >
          <Sparkles className="h-3.5 w-3.5" /> Pré-remplir 3 questions modèles vérifiables
        </button>
      </div>

      {/* Avertissement déontologique exigé Section 5 Étape 4 */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <p>
          <strong>Principe de fiabilité pédagogique :</strong> EduExam ne prétend jamais corriger
          automatiquement toutes les matières par simple lecture d’un PDF. Le <strong>Mode A</strong> est
          réservé aux questions objectives paramétrées avec précision. Pour les rédactions, démonstrations
          ou programmes, utilisez le <strong>Mode B (assisté par critères avec validation humaine)</strong> ou
          le <strong>Mode C (manuel)</strong>. Toutes les réponses attendues ci-dessous restent strictement
          confidentielles côté serveur pendant l’examen.
        </p>
      </div>

      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-800">
          Aucune question structurée définie pour le moment. Ajoutez vos questions afin que les élèves
          puissent saisir leurs réponses en regard du sujet PDF et que le barème soit associé.
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, idx) => (
            <div key={q.id} className="card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white">
                    Q{q.number}
                  </span>
                  <input
                    type="text"
                    value={q.exerciseTitle}
                    onChange={(e) => updateQuestion(idx, { exerciseTitle: e.target.value })}
                    placeholder="Titre de l'exercice (ex: Exercice 1)"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={q.type}
                    onChange={(e) => {
                      const nextType = e.target.value as QuestionType;
                      const patch: Partial<FullQuestionEditorItem> = { type: nextType };
                      if (
                        ['long_text', 'code', 'structured', 'attachment'].includes(nextType) &&
                        q.gradingMode === 'mode_a_auto'
                      ) {
                        patch.gradingMode = 'mode_b_assisted';
                      }
                      if (nextType === 'table' && !q.tableTemplate) {
                        patch.tableTemplate = {
                          headers: ['Colonne 1', 'Colonne 2'],
                          rows: [
                            ['Donnée A', ''],
                            ['Donnée B', ''],
                          ],
                        };
                      }
                      if (nextType === 'structured' && !q.structuredSections) {
                        patch.structuredSections = [
                          { id: 'p1', label: '1. Analyse / Hypothèse' },
                          { id: 'p2', label: '2. Développement' },
                          { id: 'p3', label: '3. Conclusion' },
                        ];
                      }
                      updateQuestion(idx, patch);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
                  >
                    {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={q.gradingMode}
                    onChange={(e) =>
                      updateQuestion(idx, { gradingMode: e.target.value as GradingMode })
                    }
                    className="rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                  >
                    <option value="mode_a_auto">Mode A — Auto</option>
                    <option value="mode_b_assisted">Mode B — Assisté</option>
                    <option value="mode_c_manual">Mode C — Manuel</option>
                  </select>

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={q.maxPoints}
                      onChange={(e) =>
                        updateQuestion(idx, { maxPoints: Math.max(0.25, Number(e.target.value)) })
                      }
                      className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    />
                    <span className="text-xs text-slate-500">pts</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    aria-label="Supprimer la question"
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Énoncé visible par l'élève */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Consigne ou intitulé de la question (visible par l’élève)
                </label>
                <textarea
                  rows={2}
                  value={q.prompt}
                  onChange={(e) => updateQuestion(idx, { prompt: e.target.value })}
                  placeholder="Ex: Répondez à la question 1.a du sujet PDF en détaillant le calcul..."
                  className="input-field text-sm"
                />
              </div>

              {/* Paramètres spécifiques par type */}
              {(q.type === 'mcq_single' || q.type === 'mcq_multiple') && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Options du QCM (cochez la ou les bonnes réponses confidentielles)</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextOpts = [
                          ...(q.options || []),
                          {
                            id: `opt_${Date.now().toString(36)}`,
                            label: `Proposition ${(q.options?.length || 0) + 1}`,
                          },
                        ];
                        updateQuestion(idx, { options: nextOpts });
                      }}
                      className="text-blue-600 hover:underline"
                    >
                      + Ajouter un choix
                    </button>
                  </div>
                  {(q.options || []).map((opt, oIdx) => {
                    const isCorrect = (q.rubric.correctOptionIds || []).includes(opt.id);
                    return (
                      <div key={opt.id} className="flex items-center gap-2">
                        <input
                          type={q.type === 'mcq_single' ? 'radio' : 'checkbox'}
                          name={`correct_${q.id}`}
                          checked={isCorrect}
                          onChange={() => {
                            if (q.type === 'mcq_single') {
                              updateRubric(idx, {
                                correctOptionIds: [opt.id],
                                expectedAnswer: opt.label,
                              });
                            } else {
                              const prev = q.rubric.correctOptionIds || [];
                              const nextIds = isCorrect
                                ? prev.filter((x) => x !== opt.id)
                                : [...prev, opt.id];
                              updateRubric(idx, { correctOptionIds: nextIds });
                            }
                          }}
                          className="h-4 w-4 text-emerald-600"
                        />
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const nextOpts = [...(q.options || [])];
                            nextOpts[oIdx] = { ...opt, label: e.target.value };
                            updateQuestion(idx, { options: nextOpts });
                          }}
                          className="input-field py-1.5 text-xs"
                        />
                        {(q.options?.length || 0) > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextOpts = (q.options || []).filter((_, i) => i !== oIdx);
                              updateQuestion(idx, { options: nextOpts });
                            }}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type === 'true_false' && (
                <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
                  <span className="font-semibold">Réponse attendue (confidentielle) :</span>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={q.rubric.expectedBoolean === true}
                      onChange={() =>
                        updateRubric(idx, { expectedBoolean: true, expectedAnswer: 'Vrai' })
                      }
                    />
                    <span>Vrai</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={q.rubric.expectedBoolean === false}
                      onChange={() =>
                        updateRubric(idx, { expectedBoolean: false, expectedAnswer: 'Faux' })
                      }
                    />
                    <span>Faux</span>
                  </label>
                </div>
              )}

              {q.type === 'numeric' && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900/50">
                  <div>
                    <label className="block font-semibold mb-1">Valeur attendue</label>
                    <input
                      type="number"
                      step="any"
                      value={q.rubric.numericValue ?? 0}
                      onChange={(e) =>
                        updateRubric(idx, {
                          numericValue: Number(e.target.value),
                          expectedAnswer: `${e.target.value}${
                            q.rubric.expectedUnit ? ' ' + q.rubric.expectedUnit : ''
                          }`,
                        })
                      }
                      className="input-field py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Tolérance (±)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={q.rubric.numericTolerance ?? 0}
                      onChange={(e) =>
                        updateRubric(idx, { numericTolerance: Number(e.target.value) })
                      }
                      className="input-field py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Unité attendue</label>
                    <input
                      type="text"
                      value={q.rubric.expectedUnit || ''}
                      onChange={(e) => {
                        updateQuestion(idx, { unit: e.target.value });
                        updateRubric(idx, { expectedUnit: e.target.value });
                      }}
                      placeholder="Ex: m/s, J, V"
                      className="input-field py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div className="flex items-end pb-1.5">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(q.requireUnit)}
                        onChange={(e) => updateQuestion(idx, { requireUnit: e.target.checked })}
                      />
                      <span>Exiger la saisie de l’unité</span>
                    </label>
                  </div>
                </div>
              )}

              {q.type === 'code' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-semibold mb-1">Langage informatique</label>
                    <select
                      value={q.codeLanguage || 'python'}
                      onChange={(e) =>
                        updateQuestion(idx, { codeLanguage: e.target.value as CodeLanguage })
                      }
                      className="input-field py-1.5 text-xs"
                    >
                      <option value="python">Python 3</option>
                      <option value="javascript">JavaScript</option>
                      <option value="sql">SQL</option>
                      <option value="c">Langage C</option>
                      <option value="html">HTML / CSS</option>
                      <option value="pseudocode">Pseudo-code algorithmique</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Code initial fourni à l’élève</label>
                    <input
                      type="text"
                      value={q.starterCode || ''}
                      onChange={(e) => updateQuestion(idx, { starterCode: e.target.value })}
                      placeholder="def ma_fonction(x):"
                      className="input-field py-1.5 font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Zone confidentielle : Réponse attendue, alternatives et grille de critères */}
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3.5 space-y-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                  Corrigé confidentiel & critères de réussite (jamais transmis pendant l’épreuve)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Réponse attendue de référence
                    </label>
                    <input
                      type="text"
                      value={q.rubric.expectedAnswer || ''}
                      onChange={(e) => updateRubric(idx, { expectedAnswer: e.target.value })}
                      placeholder="Réponse type officielle..."
                      className="input-field py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Réponses alternatives acceptées (séparées par des points-virgules)
                    </label>
                    <input
                      type="text"
                      value={(q.rubric.acceptedAlternatives || []).join(' ; ')}
                      onChange={(e) =>
                        updateRubric(idx, {
                          acceptedAlternatives: e.target.value
                            .split(';')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Variante 1 ; Variante 2"
                      className="input-field py-1.5 text-xs"
                    />
                  </div>
                </div>

                {q.gradingMode === 'mode_b_assisted' && (
                  <div className="space-y-2 border-t border-emerald-200/60 pt-2.5 dark:border-emerald-900/40">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">
                        Grille de critères et points partiels (Mode B — Correction assistée)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const newCrit: RubricCriterion = {
                            id: `crit_${Date.now().toString(36)}`,
                            description: 'Critère attendu',
                            points: 1,
                            keywords: [],
                          };
                          updateRubric(idx, {
                            criteria: [...(q.rubric.criteria || []), newCrit],
                          });
                        }}
                        className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        + Ajouter un critère partiel
                      </button>
                    </div>

                    {(q.rubric.criteria || []).map((c, cIdx) => (
                      <div key={c.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={c.description}
                          onChange={(e) => {
                            const list = [...q.rubric.criteria];
                            list[cIdx] = { ...c, description: e.target.value };
                            updateRubric(idx, { criteria: list });
                          }}
                          placeholder="Critère de réussite"
                          className="input-field py-1 text-xs sm:col-span-5"
                        />
                        <input
                          type="text"
                          value={(c.keywords || []).join(', ')}
                          onChange={(e) => {
                            const list = [...q.rubric.criteria];
                            list[cIdx] = {
                              ...c,
                              keywords: e.target.value
                                .split(',')
                                .map((k) => k.trim())
                                .filter(Boolean),
                            };
                            updateRubric(idx, { criteria: list });
                          }}
                          placeholder="Mots-clés attendus (optionnel)"
                          className="input-field py-1 text-xs sm:col-span-4"
                        />
                        <input
                          type="number"
                          step="0.25"
                          value={c.points}
                          onChange={(e) => {
                            const list = [...q.rubric.criteria];
                            list[cIdx] = { ...c, points: Number(e.target.value) };
                            updateRubric(idx, { criteria: list });
                          }}
                          className="input-field py-1 text-xs sm:col-span-2 text-center"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const list = q.rubric.criteria.filter((_, i) => i !== cIdx);
                            updateRubric(idx, { criteria: list });
                          }}
                          className="text-red-500 hover:text-red-700 sm:col-span-1 flex justify-center"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}

                    <label className="flex items-center gap-2 pt-1 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(q.rubric.enableIndicativeAiAssist)}
                        onChange={(e) =>
                          updateRubric(idx, { enableIndicativeAiAssist: e.target.checked })
                        }
                      />
                      <span>
                        Activer la pré-évaluation assistée <strong>strictement indicative</strong> par
                        analyse des éléments attendus (validation humaine obligatoire avant publication
                        de la note).
                      </span>
                    </label>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1">
                    Explication / commentaire pédagogique type
                  </label>
                  <input
                    type="text"
                    value={q.rubric.pedagogicalExplanation || ''}
                    onChange={(e) =>
                      updateRubric(idx, { pedagogicalExplanation: e.target.value })
                    }
                    placeholder="Rappel de cours ou explication affichée lors de la restitution..."
                    className="input-field py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
