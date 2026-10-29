import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Award,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Home as HomeIcon,
  RefreshCw,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { TeacherLayout } from '../components/TeacherLayout';
import {
  AppreciationLabel,
  Exam,
  StudentSubmissionReceipt,
  Submission,
} from '../types';
import {
  fetchStudentSubmissionReceipt,
  listTeacherSubmissions,
  loadStudentSessionCtx,
} from '../services/submissions';
import { listTeacherExams } from '../services/exams';
import { formatStudentAnswerSummary, round2 } from '../services/grading';
import { downloadStudentPdfReport, exportSubmissionsToCsv } from '../services/pdf';

// ============================================================================
// 1. VUE ÉLÈVE : CONFIRMATION DE SOUMISSION & RÉSULTAT (PDF B)
// ============================================================================
export const StudentResultPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const submissionId = searchParams.get('submissionId');

  const [receipt, setReceipt] = useState<StudentSubmissionReceipt | null>(() => {
    try {
      const raw = sessionStorage.getItem('eduexam_last_receipt');
      return raw ? (JSON.parse(raw) as StudentSubmissionReceipt) : null;
    } catch {
      return null;
    }
  });
  const [refreshing, setRefreshing] = useState(false);

  const refreshFromServer = async () => {
    const ctx = loadStudentSessionCtx();
    const targetId = submissionId || receipt?.submissionId || ctx?.submissionId;
    if (!targetId || !ctx?.sessionToken) return;
    setRefreshing(true);
    try {
      const updated = await fetchStudentSubmissionReceipt(targetId, ctx.sessionToken);
      setReceipt(updated);
      sessionStorage.setItem('eduexam_last_receipt', JSON.stringify(updated));
    } catch {
      // keep cached receipt
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshFromServer();
  }, [submissionId]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 space-y-6">
        {!receipt ? (
          <div className="card p-8 text-center space-y-4">
            <h1 className="text-xl font-bold">Aucun résultat en mémoire sur ce navigateur</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Si vous venez de soumettre une copie, assurez-vous d’utiliser l’onglet de votre
              session d’examen.
            </p>
            <Link to="/eleve" className="btn-primary">
              Retour à l’espace élève
            </Link>
          </div>
        ) : (
          <>
            {/* Bandeau officiel de confirmation */}
            <div className="card p-6 sm:p-8 border-2 border-emerald-500/50 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                      Copie enregistrée et verrouillée avec succès
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Référence officielle :{' '}
                      <strong className="font-mono">{receipt.submissionId}</strong> • Transmise le{' '}
                      {new Date(receipt.submittedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={refreshFromServer}
                    className="btn-secondary text-xs py-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    <span>Actualiser l’état</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadStudentPdfReport(receipt)}
                    className="btn-primary text-xs py-2"
                  >
                    <Download className="h-4 w-4" />
                    <span>Télécharger mon rapport PDF (PDF B)</span>
                  </button>
                </div>
              </div>

              {/* Bloc note si autorisé par le professeur */}
              {receipt.canViewScore && receipt.normalizedScoreOn20 !== undefined ? (
                <div className="rounded-xl bg-emerald-50/80 border border-emerald-200 p-5 flex flex-wrap items-center justify-between gap-4 dark:bg-emerald-950/30 dark:border-emerald-900">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                      Résultat de votre évaluation ({receipt.examTitle})
                    </div>
                    <div className="mt-1 text-3xl font-extrabold text-emerald-950 dark:text-white">
                      {receipt.normalizedScoreOn20} / 20
                      {receipt.examMaxScore !== 20 && (
                        <span className="ml-2 text-base font-semibold text-slate-600 dark:text-slate-300">
                          ({receipt.finalScoreOutOfMax} / {receipt.examMaxScore})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1 text-sm font-bold text-white">
                      <Award className="h-4 w-4" /> Mention : {receipt.appreciation}
                    </span>
                    <div className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Réussite : {receipt.percentage}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-4 text-xs sm:text-sm text-blue-950 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200">
                  Votre enseignant a bien été notifié de la remise de votre copie. La note et les
                  commentaires apparaîtront dès que la correction sera validée et ouverte à la
                  consultation.
                </div>
              )}

              {receipt.canViewScore && receipt.generalComment && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <strong>Commentaire général de votre enseignant :</strong>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    {receipt.generalComment}
                  </p>
                </div>
              )}
            </div>

            {/* Détail question par question selon autorisations */}
            {receipt.questions.length > 0 && (
              <div className="card p-6 space-y-4">
                <h2 className="text-base font-bold">Récapitulatif de vos réponses enregistrées</h2>
                <div className="space-y-3">
                  {receipt.questions.map((q) => {
                    const g = receipt.questionGrades?.[q.id];
                    return (
                      <div
                        key={q.id}
                        className="rounded-xl border border-slate-200 p-4 space-y-2 text-sm dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            Q{q.number} — {q.exerciseTitle}
                          </span>
                          {receipt.canViewScore && g && (
                            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                              {g.pointsObtained} / {q.maxPoints} pt(s)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">{q.prompt}</p>
                        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
                          <strong>Votre réponse : </strong>
                          <span className="whitespace-pre-wrap">
                            {formatStudentAnswerSummary(q, receipt.answers[q.id])}
                          </span>
                        </div>
                        {receipt.canViewExpectedAnswers && g?.expectedAnswerDisplay && (
                          <div className="rounded-lg bg-emerald-50/70 p-2.5 text-xs text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <strong>Réponse attendue : </strong> {g.expectedAnswerDisplay}
                          </div>
                        )}
                        {receipt.canViewScore && g?.comment && (
                          <div className="text-xs text-slate-600 dark:text-slate-400 italic">
                            Commentaire : {g.comment}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <Link to="/" className="btn-secondary text-xs">
                <HomeIcon className="h-4 w-4" /> Retour à l’accueil EduExam
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

// ============================================================================
// 2. VUE PROFESSEUR : NOTES ET STATISTIQUES DÉTAILLÉES (Entrée 5 du menu)
// ============================================================================
export const Results: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listTeacherExams(), listTeacherSubmissions()])
      .then(([ex, subs]) => {
        setExams(ex);
        setSubmissions(subs);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredSubs = useMemo(
    () =>
      selectedExamId
        ? submissions.filter((s) => s.examId === selectedExamId)
        : submissions,
    [submissions, selectedExamId]
  );

  const stats = useMemo(() => {
    const scores = filteredSubs.map((s) => s.normalizedScoreOn20).sort((a, b) => a - b);
    if (scores.length === 0) {
      return null;
    }
    const count = scores.length;
    const mean = round2(scores.reduce((a, b) => a + b, 0) / count);
    const median =
      count % 2 === 1
        ? scores[Math.floor(count / 2)]
        : round2((scores[count / 2 - 1] + scores[count / 2]) / 2);
    const min = scores[0];
    const max = scores[count - 1];
    const variance = scores.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / count;
    const stdDev = round2(Math.sqrt(variance));
    const passRate = round2((scores.filter((s) => s >= 10).length / count) * 100);

    const mentionsOrder: AppreciationLabel[] = [
      'Excellent',
      'Bien',
      'Assez bien',
      'Passable',
      'Insuffisant',
    ];
    const distribution = mentionsOrder.map((m) => {
      const n = filteredSubs.filter((s) => s.appreciation === m).length;
      return {
        label: m,
        count: n,
        percent: round2((n / count) * 100),
      };
    });

    return { count, mean, median, min, max, stdDev, passRate, distribution };
  }, [filteredSubs]);

  return (
    <TeacherLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Notes et statistiques pédagogiques
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Analyse de la distribution des notes sur 20, médiane, écart-type et répartition des
              mentions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="input-field py-2 text-xs w-64"
            >
              <option value="">Tous mes examens confondus</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.className})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={filteredSubs.length === 0}
              onClick={() => exportSubmissionsToCsv(filteredSubs, 'Statistiques_Notes')}
              className="btn-secondary text-xs py-2"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Exporter CSV</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="card p-10 text-center text-sm text-slate-500">
            Calcul des indicateurs statistiques...
          </div>
        ) : !stats ? (
          <div className="card p-10 text-center text-sm text-slate-500">
            Aucune copie disponible pour calculer les statistiques sur cette sélection.
          </div>
        ) : (
          <>
            {/* Indicateurs clés */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Copies analysées', value: stats.count },
                { label: 'Moyenne (/20)', value: `${stats.mean}` },
                { label: 'Médiane (/20)', value: `${stats.median}` },
                { label: 'Écart-type', value: `${stats.stdDev}` },
                { label: 'Min / Max (/20)', value: `${stats.min} – ${stats.max}` },
                { label: 'Réussite (≥ 10)', value: `${stats.passRate}%` },
              ].map((k) => (
                <div key={k.label} className="card p-4">
                  <div className="text-xs text-slate-500">{k.label}</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
                    {k.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Histogramme des appréciations */}
            <div className="card p-6 space-y-4">
              <div className="flex items-center gap-2 text-base font-bold">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                <span>Répartition par tranche d’appréciation officielle (sur 20)</span>
              </div>

              <div className="space-y-3">
                {stats.distribution.map((d) => (
                  <div key={d.label} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>
                        {d.label}{' '}
                        <span className="font-normal text-slate-500">
                          {d.label === 'Excellent'
                            ? '(≥ 16)'
                            : d.label === 'Bien'
                            ? '[14 ; 16['
                            : d.label === 'Assez bien'
                            ? '[12 ; 14['
                            : d.label === 'Passable'
                            ? '[10 ; 12['
                            : '(< 10)'}
                        </span>
                      </span>
                      <span>
                        {d.count} élève(s) ({d.percent}%)
                      </span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          d.label === 'Insuffisant' ? 'bg-red-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.max(d.count > 0 ? 4 : 0, d.percent)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </TeacherLayout>
  );
};
