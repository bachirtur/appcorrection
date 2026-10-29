import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Mail,
  Save,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { PdfViewer } from '../components/PdfViewer';
import {
  Exam,
  QuestionGradeResult,
  QuestionRubricSecret,
  Submission,
} from '../types';
import { fetchTeacherPrivatePdfBytes, listTeacherExams } from '../services/exams';
import {
  deleteTeacherSubmission,
  getSubmissionForTeacherGrading,
  listTeacherSubmissions,
  resendTeacherSubmissionEmail,
  saveTeacherSubmissionGrade,
  SubmissionFilters,
} from '../services/submissions';
import { formatStudentAnswerSummary, round2 } from '../services/grading';
import {
  buildTeacherPdfReportBytes,
  downloadStudentPdfReport,
  downloadTeacherPdfReport,
  exportSubmissionsToCsv,
} from '../services/pdf';

export const Submissions: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('submissionId');

  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Les 6 filtres exigés (Section 14)
  const [filters, setFilters] = useState<SubmissionFilters>({
    examId: '',
    className: '',
    subject: '',
    gradingStatus: '',
    minScore: '',
    maxScore: '',
    fromDate: '',
    toDate: '',
  });

  // Vue détaillée de correction d'une copie
  const [activeSub, setActiveSub] = useState<Submission | null>(null);
  const [activeRubrics, setActiveRubrics] = useState<Record<string, QuestionRubricSecret>>({});
  const [correctionBytes, setCorrectionBytes] = useState<Uint8Array | null>(null);
  const [editGrades, setEditGrades] = useState<Record<string, QuestionGradeResult>>({});
  const [manualDirectScore, setManualDirectScore] = useState<number>(0);
  const [generalComment, setGeneralComment] = useState<string>('');
  const [showScore, setShowScore] = useState<boolean>(true);
  const [showExpected, setShowExpected] = useState<boolean>(false);
  const [auditReason, setAuditReason] = useState<string>('');
  const [savingGrade, setSavingGrade] = useState<boolean>(false);

  const loadList = async () => {
    setLoading(true);
    try {
      const [exList, subList] = await Promise.all([
        listTeacherExams(),
        listTeacherSubmissions(filters),
      ]);
      setExams(exList);
      setSubmissions(subList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement des copies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [filters]);

  useEffect(() => {
    if (!selectedId) {
      setActiveSub(null);
      setCorrectionBytes(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const detail = await getSubmissionForTeacherGrading(selectedId);
        if (!mounted) return;
        setActiveSub(detail.submission);
        setActiveRubrics(detail.rubrics || {});
        setEditGrades(structuredClone(detail.submission.questionGrades || {}));
        setManualDirectScore(detail.submission.finalScoreOutOfMax);
        setGeneralComment(detail.submission.generalComment || '');
        setShowScore(detail.submission.showScoreToStudent);
        setShowExpected(detail.submission.showExpectedAnswersToStudent);
        setAuditReason('');

        if (detail.hasCorrectionPdf) {
          fetchTeacherPrivatePdfBytes(detail.submission.examId, 'correction')
            .then((b) => mounted && setCorrectionBytes(b))
            .catch(() => mounted && setCorrectionBytes(null));
        } else {
          setCorrectionBytes(null);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Copie inaccessible.');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const handleSaveGrading = async (validateNow: boolean) => {
    if (!activeSub) return;
    setSavingGrade(true);
    setError(null);
    try {
      const updated = await saveTeacherSubmissionGrade(activeSub.id, {
        questionGrades:
          activeSub.questionsSnapshot.length > 0 ? editGrades : undefined,
        manualDirectScoreOutOfMax:
          activeSub.questionsSnapshot.length === 0 ? manualDirectScore : undefined,
        generalComment,
        validateNow,
        showScoreToStudent: showScore,
        showExpectedAnswersToStudent: showExpected,
        auditReason,
      });
      setActiveSub(updated);
      setEditGrades(structuredClone(updated.questionGrades || {}));
      setAuditReason('');
      setNotice(
        validateNow
          ? 'Note validée officiellement et enregistrée dans le journal d’audit.'
          : 'Modifications de correction enregistrées.'
      );
      setTimeout(() => setNotice(null), 3500);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’enregistrement de la note.');
    } finally {
      setSavingGrade(false);
    }
  };

  const handleResendEmail = async () => {
    if (!activeSub) return;
    try {
      const { bytes } = buildTeacherPdfReportBytes(activeSub, activeRubrics);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const pdfBase64 = btoa(binary);
      const emailStatus = await resendTeacherSubmissionEmail(activeSub.id, pdfBase64);
      setActiveSub({ ...activeSub, emailNotification: emailStatus });
      setNotice(`Notification e-mail traitée (statut : ${emailStatus.status}).`);
      setTimeout(() => setNotice(null), 4000);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la relance e-mail.');
    }
  };

  const handleDeleteCopy = async (subId: string) => {
    if (!window.confirm('Supprimer définitivement cette copie selon vos règles de conservation ?')) {
      return;
    }
    try {
      await deleteTeacherSubmission(subId);
      if (selectedId === subId) setSearchParams({});
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer la copie.');
    }
  };

  return (
    <TeacherLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Copies des élèves & Correction
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Consultez, filtrez, corrigez et validez les copies avec traçabilité d’audit complète.
            </p>
          </div>

          <button
            type="button"
            disabled={submissions.length === 0}
            onClick={() => exportSubmissionsToCsv(submissions)}
            className="btn-secondary text-xs py-2.5"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Exporter les résultats filtrés (CSV)</span>
          </button>
        </div>

        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Barre de filtres multicritères (Section 14) */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-blue-600" /> Filtres de recherche
            </span>
            <button
              type="button"
              onClick={() =>
                setFilters({
                  examId: '',
                  className: '',
                  subject: '',
                  gradingStatus: '',
                  minScore: '',
                  maxScore: '',
                  fromDate: '',
                  toDate: '',
                })
              }
              className="text-blue-600 hover:underline font-medium"
            >
              Réinitialiser les filtres
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={filters.examId}
              onChange={(e) => setFilters({ ...filters, examId: e.target.value })}
              className="input-field py-2 text-xs"
            >
              <option value="">Tous les examens</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.examCode})
                </option>
              ))}
            </select>

            <input
              type="text"
              value={filters.className}
              onChange={(e) => setFilters({ ...filters, className: e.target.value })}
              placeholder="Filtrer par classe (ex: Terminale)"
              className="input-field py-2 text-xs"
            />

            <input
              type="text"
              value={filters.subject}
              onChange={(e) => setFilters({ ...filters, subject: e.target.value })}
              placeholder="Filtrer par matière"
              className="input-field py-2 text-xs"
            />

            <select
              value={filters.gradingStatus}
              onChange={(e) => setFilters({ ...filters, gradingStatus: e.target.value })}
              className="input-field py-2 text-xs"
            >
              <option value="">Tous les états de correction</option>
              <option value="pending_review">À corriger / À valider</option>
              <option value="auto_graded">Corrigée automatiquement</option>
              <option value="validated">Validée officiellement</option>
            </select>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={20}
                value={filters.minScore}
                onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}
                placeholder="Note min /20"
                className="input-field py-2 text-xs"
              />
              <input
                type="number"
                min={0}
                max={20}
                value={filters.maxScore}
                onChange={(e) => setFilters({ ...filters, maxScore: e.target.value })}
                placeholder="Note max /20"
                className="input-field py-2 text-xs"
              />
            </div>

            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
              className="input-field py-2 text-xs"
              title="Date de début"
            />

            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
              className="input-field py-2 text-xs"
              title="Date de fin"
            />
          </div>
        </div>

        {/* Vue détaillée d'une copie ouverte */}
        {activeSub && (
          <div className="card border-2 border-blue-600/40 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-900 px-5 py-4 text-white">
              <div>
                <h2 className="text-base font-bold">
                  Copie de {activeSub.student.lastName.toUpperCase()}{' '}
                  {activeSub.student.firstName} — {activeSub.student.className}
                </h2>
                <p className="text-xs text-blue-200">
                  {activeSub.examTitle} ({activeSub.examCode}) • Réf : {activeSub.id} • Note
                  actuelle : <strong>{activeSub.normalizedScoreOn20} / 20</strong> (
                  {activeSub.appreciation})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadTeacherPdfReport(activeSub, activeRubrics)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
                >
                  <Download className="h-3.5 w-3.5" /> PDF A (Professeur)
                </button>

                <button
                  type="button"
                  onClick={() =>
                    downloadStudentPdfReport({
                      submissionId: activeSub.id,
                      examCode: activeSub.examCode,
                      examTitle: activeSub.examTitle,
                      subject: activeSub.subject,
                      student: activeSub.student,
                      startedAt: activeSub.startedAt,
                      submittedAt: activeSub.submittedAt,
                      durationSeconds: activeSub.durationSeconds,
                      autoSubmitted: activeSub.autoSubmitted,
                      gradingStatus: activeSub.gradingStatus,
                      canViewScore: showScore,
                      canViewExpectedAnswers: showExpected,
                      examMaxScore: activeSub.examMaxScore,
                      rawPointsObtained: showScore ? activeSub.rawPointsObtained : undefined,
                      rawPointsMax: showScore ? activeSub.rawPointsMax : undefined,
                      finalScoreOutOfMax: showScore ? activeSub.finalScoreOutOfMax : undefined,
                      normalizedScoreOn20: showScore ? activeSub.normalizedScoreOn20 : undefined,
                      percentage: showScore ? activeSub.percentage : undefined,
                      appreciation: showScore ? activeSub.appreciation : undefined,
                      generalComment: showScore ? generalComment : undefined,
                      questions: activeSub.questionsSnapshot,
                      answers: activeSub.answers,
                      questionGrades: showScore ? activeSub.questionGrades : undefined,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
                >
                  <FileText className="h-3.5 w-3.5" /> PDF B (Élève)
                </button>

                <button
                  type="button"
                  onClick={handleResendEmail}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
                >
                  <Mail className="h-3.5 w-3.5" /> Renvoyer e-mail
                </button>

                <button
                  type="button"
                  onClick={() => setSearchParams({})}
                  className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
                  aria-label="Fermer la copie"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-6">
              {/* Aperçu côte-à-côte si le professeur a importé un corrigé PDF officiel */}
              {correctionBytes && (
                <details className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <summary className="cursor-pointer text-xs font-bold text-emerald-900 dark:text-emerald-300">
                    Afficher / masquer votre corrigé officiel PDF confidentiel pendant la notation
                  </summary>
                  <div className="mt-3">
                    <PdfViewer
                      pdfBytes={correctionBytes}
                      fileName="Correction_Officielle.pdf"
                      allowDownload={true}
                      title="Corrigé officiel (réservé au professeur)"
                      heightClass="h-[420px]"
                    />
                  </div>
                </details>
              )}

              {/* Correction question par question */}
              {activeSub.questionsSnapshot.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-xs font-bold text-slate-500 mb-2">
                      Réponse libre transmise par l’élève :
                    </div>
                    <p className="whitespace-pre-wrap text-sm">
                      {activeSub.answers.free_response?.text || '(Aucune réponse saisie)'}
                    </p>
                  </div>
                  <div className="max-w-xs">
                    <label className="block text-xs font-bold mb-1">
                      Note attribuée (sur {activeSub.examMaxScore})
                    </label>
                    <input
                      type="number"
                      step="0.25"
                      min={0}
                      max={activeSub.examMaxScore}
                      value={manualDirectScore}
                      onChange={(e) => setManualDirectScore(Number(e.target.value))}
                      className="input-field font-bold"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeSub.questionsSnapshot.map((q) => {
                    const g = editGrades[q.id] || {
                      questionId: q.id,
                      pointsObtained: 0,
                      maxPoints: q.maxPoints,
                      state: 'manual_pending',
                      comment: '',
                    };
                    const rubric = activeRubrics[q.id];
                    const studentAns = activeSub.answers[q.id];

                    return (
                      <div
                        key={q.id}
                        className="rounded-xl border border-slate-200 p-4 space-y-3 dark:border-slate-800"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <span className="text-xs font-bold text-blue-700 dark:text-blue-400">
                              Q{q.number} — {q.exerciseTitle} ({q.gradingMode})
                            </span>
                            <p className="text-sm font-medium mt-0.5">{q.prompt}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            {g.isIndicativeAi && (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
                                Pré-note indicative à valider
                              </span>
                            )}
                            <input
                              type="number"
                              step="0.25"
                              min={0}
                              max={q.maxPoints}
                              value={g.pointsObtained}
                              onChange={(e) =>
                                setEditGrades({
                                  ...editGrades,
                                  [q.id]: {
                                    ...g,
                                    pointsObtained: Number(e.target.value),
                                  },
                                })
                              }
                              className="w-20 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-center text-sm font-bold dark:bg-slate-900"
                            />
                            <span className="text-xs font-bold text-slate-500">
                              / {q.maxPoints} pts
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                            <div className="font-bold text-slate-600 dark:text-slate-400 mb-1">
                              Réponse de l’élève :
                            </div>
                            <pre className="whitespace-pre-wrap font-sans text-slate-900 dark:text-slate-100">
                              {formatStudentAnswerSummary(q, studentAns)}
                            </pre>
                            {studentAns?.attachment?.dataUrl &&
                              studentAns.attachment.mimeType.startsWith('image/') && (
                                <img
                                  src={studentAns.attachment.dataUrl}
                                  alt={studentAns.attachment.fileName}
                                  className="mt-2 max-h-48 rounded border border-slate-300"
                                />
                              )}
                          </div>

                          <div className="rounded-lg bg-emerald-50/50 p-3 dark:bg-emerald-950/20">
                            <div className="font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                              Réponse attendue / Barème :
                            </div>
                            <p className="whitespace-pre-wrap">
                              {rubric?.expectedAnswer || g.expectedAnswerDisplay || '—'}
                            </p>

                            {/* Grille de critères cliquable pour Mode B */}
                            {rubric?.criteria && rubric.criteria.length > 0 && (
                              <div className="mt-2 space-y-1 border-t border-emerald-200/60 pt-2">
                                <div className="font-semibold">Critères partiels :</div>
                                {rubric.criteria.map((crit) => {
                                  const checked = (g.matchedCriteriaIds || []).includes(crit.id);
                                  return (
                                    <label
                                      key={crit.id}
                                      className="flex items-center justify-between gap-2 cursor-pointer"
                                    >
                                      <span className="inline-flex items-center gap-1.5">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            const prevIds = g.matchedCriteriaIds || [];
                                            const nextIds = checked
                                              ? prevIds.filter((id) => id !== crit.id)
                                              : [...prevIds, crit.id];
                                            const sumPts = round2(
                                              Math.min(
                                                q.maxPoints,
                                                rubric.criteria
                                                  .filter((c) => nextIds.includes(c.id))
                                                  .reduce((a, b) => a + b.points, 0)
                                              )
                                            );
                                            setEditGrades({
                                              ...editGrades,
                                              [q.id]: {
                                                ...g,
                                                matchedCriteriaIds: nextIds,
                                                pointsObtained: sumPts,
                                              },
                                            });
                                          }}
                                        />
                                        <span>{crit.description}</span>
                                      </span>
                                      <span className="font-bold">+{crit.points} pt</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            value={g.comment || ''}
                            onChange={(e) =>
                              setEditGrades({
                                ...editGrades,
                                [q.id]: { ...g, comment: e.target.value },
                              })
                            }
                            placeholder="Commentaire pédagogique pour cette question..."
                            className="input-field py-1.5 text-xs"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Commentaire général, Options de restitution & Motif d'audit */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="space-y-3">
                  <label className="block text-xs font-bold">
                    Appréciation et commentaire général sur la copie
                  </label>
                  <textarea
                    rows={3}
                    value={generalComment}
                    onChange={(e) => setGeneralComment(e.target.value)}
                    placeholder="Bilan global, points forts et axes de progression..."
                    className="input-field text-xs"
                  />

                  <div className="flex flex-col gap-2 text-xs">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showScore}
                        onChange={(e) => setShowScore(e.target.checked)}
                      />
                      <span>Autoriser l’affichage de la note et du détail des points à l’élève</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showExpected}
                        onChange={(e) => setShowExpected(e.target.checked)}
                      />
                      <span>
                        Autoriser l’affichage des réponses attendues dans le résultat élève (PDF B)
                      </span>
                    </label>
                  </div>
                </div>

                {/* Suivi d'intégrité & Journal d'audit */}
                <div className="space-y-3 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="font-bold flex items-center gap-1.5 mb-1">
                      <ShieldAlert className="h-4 w-4 text-amber-600" />
                      Événements d’intégrité signalés ({activeSub.integrityEvents?.length || 0})
                    </div>
                    {activeSub.integrityEvents?.length ? (
                      <ul className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                        {activeSub.integrityEvents.map((ev) => (
                          <li key={ev.id}>
                            [{new Date(ev.timestamp).toLocaleTimeString('fr-FR')}] {ev.type} —{' '}
                            {ev.details}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">Aucun événement signalé pendant l’épreuve.</p>
                    )}
                  </div>

                  {activeSub.gradingStatus === 'validated' && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                      <label className="block font-bold text-amber-950 dark:text-amber-200 mb-1">
                        Motif obligatoire de modification après validation (Journal d’audit) *
                      </label>
                      <input
                        type="text"
                        value={auditReason}
                        onChange={(e) => setAuditReason(e.target.value)}
                        placeholder="Ex: Revalorisation suite à double lecture de l’exercice 2"
                        className="input-field py-1.5 text-xs"
                      />
                    </div>
                  )}

                  {activeSub.auditTrail?.length > 0 && (
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="font-bold flex items-center gap-1.5 mb-1">
                        <History className="h-3.5 w-3.5 text-blue-600" />
                        Journal d’audit ({activeSub.auditTrail.length})
                      </div>
                      <ul className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-slate-500">
                        {activeSub.auditTrail.map((log) => (
                          <li key={log.id}>
                            {new Date(log.timestamp).toLocaleString('fr-FR')} —{' '}
                            <strong>{log.action}</strong> : {log.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={savingGrade}
                  onClick={() => handleSaveGrading(false)}
                  className="btn-secondary text-xs"
                >
                  <Save className="h-4 w-4" /> Enregistrer sans clôturer la validation
                </button>
                <button
                  type="button"
                  disabled={savingGrade}
                  onClick={() => handleSaveGrading(true)}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-xs"
                >
                  <CheckCircle2 className="h-4 w-4" /> Valider officiellement la note
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tableau principal des copies (Section 14 : les 10 colonnes exigées) */}
        <div className="card overflow-x-auto">
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Chargement des soumissions...
            </div>
          ) : submissions.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Aucune copie ne correspond aux critères sélectionnés.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3.5 py-3 text-left font-semibold">Nom et prénom</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Classe</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Examen</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Soumission</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Durée</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Note (/20)</th>
                  <th className="px-3.5 py-3 text-left font-semibold">%</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Correction</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Rapport e-mail</th>
                  <th className="px-3.5 py-3 text-left font-semibold">Incidents</th>
                  <th className="px-3.5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {submissions.map((s) => (
                  <tr
                    key={s.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                      selectedId === s.id ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <td className="px-3.5 py-3 font-semibold text-slate-900 dark:text-white">
                      {s.student.lastName.toUpperCase()} {s.student.firstName}
                    </td>
                    <td className="px-3.5 py-3">{s.student.className}</td>
                    <td className="px-3.5 py-3">
                      <div className="font-medium truncate max-w-[160px]">{s.examTitle}</div>
                      <div className="text-[11px] text-slate-500">{s.subject}</div>
                    </td>
                    <td className="px-3.5 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {new Date(s.submittedAt).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      {Math.max(1, Math.round(s.durationSeconds / 60))} min
                    </td>
                    <td className="px-3.5 py-3 font-bold">
                      {s.normalizedScoreOn20} / 20
                      <span className="block text-[11px] font-normal text-slate-500">
                        {s.appreciation}
                      </span>
                    </td>
                    <td className="px-3.5 py-3">{s.percentage}%</td>
                    <td className="px-3.5 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          s.gradingStatus === 'validated'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : s.gradingStatus === 'auto_graded'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {s.gradingStatus === 'validated'
                          ? 'Validée'
                          : s.gradingStatus === 'auto_graded'
                          ? 'Auto'
                          : 'À valider'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      {s.emailNotification?.status === 'sent' ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          Envoyé
                        </span>
                      ) : s.emailNotification?.status === 'logged_no_smtp' ? (
                        <span
                          title={s.emailNotification.error}
                          className="text-slate-600 dark:text-slate-400"
                        >
                          Journalisé
                        </span>
                      ) : (
                        <span
                          title={s.emailNotification?.error}
                          className="text-amber-700 dark:text-amber-400"
                        >
                          {s.emailNotification?.status || 'En attente'}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      {s.integrityEvents?.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> {s.integrityEvents.length}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSearchParams({ submissionId: s.id })}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Ouvrir
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadTeacherPdfReport(s)}
                          title="Télécharger PDF A"
                          className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCopy(s.id)}
                          title="Supprimer"
                          className="rounded-md border border-red-200 p-1 text-red-600 hover:bg-red-50 dark:border-red-900"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
};
