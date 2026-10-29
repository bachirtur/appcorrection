import React, { useEffect, useState } from 'react';
import { Download, FileCheck2, FileSpreadsheet, FileText } from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { Exam, Submission } from '../types';
import { listTeacherExams } from '../services/exams';
import { listTeacherSubmissions } from '../services/submissions';
import {
  downloadExamClassReportPdf,
  downloadStudentPdfReport,
  downloadTeacherPdfReport,
  exportSubmissionsToCsv,
} from '../services/pdf';

export const ReportsPage: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listTeacherExams(), listTeacherSubmissions()])
      .then(([ex, subs]) => {
        setExams(ex);
        setSubmissions(subs);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <TeacherLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Centre des Rapports PDF & Exports
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Générez vos rapports confidentiels enseignant (PDF A), les relevés élèves filtrés
            (PDF B), les bilans de classe et les exports tableur CSV.
          </p>
        </div>

        {/* Bilans par examen */}
        <div className="card p-6 space-y-4">
          <h2 className="text-base font-bold">1. Bilans récapitulatifs par examen (Classe)</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Chargement...</p>
          ) : exams.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun examen disponible.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {exams.map((ex) => {
                const examSubs = submissions.filter((s) => s.examId === ex.id);
                return (
                  <div
                    key={ex.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{ex.title}</div>
                      <div className="text-xs text-slate-500">
                        {ex.subject} • {ex.className} • {examSubs.length} copie(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={examSubs.length === 0}
                        onClick={() => downloadExamClassReportPdf(ex, examSubs)}
                        className="btn-primary text-xs py-1.5"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" /> Bilan PDF Classe
                      </button>
                      <button
                        type="button"
                        disabled={examSubs.length === 0}
                        onClick={() => exportSubmissionsToCsv(examSubs, `Notes_${ex.examCode}`)}
                        className="btn-secondary text-xs py-1.5"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> CSV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rapports individuels PDF A & PDF B */}
        <div className="card p-6 space-y-4">
          <h2 className="text-base font-bold">
            2. Rapports individuels de copies (PDF A Professeur & PDF B Élève)
          </h2>
          {submissions.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune copie soumise pour le moment.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {submissions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {s.student.lastName.toUpperCase()} {s.student.firstName} ({s.student.className})
                    </div>
                    <div className="text-xs text-slate-500">
                      {s.examTitle} • Note : <strong>{s.normalizedScoreOn20}/20</strong> (
                      {s.appreciation}) • Réf : {s.id}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadTeacherPdfReport(s)}
                      className="btn-secondary text-xs py-1.5"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-600" /> PDF A (Professeur)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadStudentPdfReport({
                          submissionId: s.id,
                          examCode: s.examCode,
                          examTitle: s.examTitle,
                          subject: s.subject,
                          student: s.student,
                          startedAt: s.startedAt,
                          submittedAt: s.submittedAt,
                          durationSeconds: s.durationSeconds,
                          autoSubmitted: s.autoSubmitted,
                          gradingStatus: s.gradingStatus,
                          canViewScore: s.showScoreToStudent,
                          canViewExpectedAnswers: s.showExpectedAnswersToStudent,
                          examMaxScore: s.examMaxScore,
                          rawPointsObtained: s.showScoreToStudent ? s.rawPointsObtained : undefined,
                          rawPointsMax: s.showScoreToStudent ? s.rawPointsMax : undefined,
                          finalScoreOutOfMax: s.showScoreToStudent
                            ? s.finalScoreOutOfMax
                            : undefined,
                          normalizedScoreOn20: s.showScoreToStudent
                            ? s.normalizedScoreOn20
                            : undefined,
                          percentage: s.showScoreToStudent ? s.percentage : undefined,
                          appreciation: s.showScoreToStudent ? s.appreciation : undefined,
                          generalComment: s.showScoreToStudent ? s.generalComment : undefined,
                          questions: s.questionsSnapshot,
                          answers: s.answers,
                          questionGrades: s.showScoreToStudent ? s.questionGrades : undefined,
                        })
                      }
                      className="btn-secondary text-xs py-1.5"
                    >
                      <FileText className="h-3.5 w-3.5 text-emerald-600" /> PDF B (Élève)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
};
