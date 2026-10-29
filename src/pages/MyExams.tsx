import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  Copy,
  Edit3,
  FilePlus2,
  Lock,
  Trash2,
} from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { ReauthModal } from '../components/ReauthModal';
import { Exam, ExamStatus } from '../types';
import {
  deleteExamWithIdentityCheck,
  listTeacherExams,
  updateExamStatus,
} from '../services/exams';

const STATUS_BADGES: Record<ExamStatus, { label: string; cls: string }> = {
  draft: {
    label: 'Brouillon',
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  published: {
    label: 'Publié',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  closed: {
    label: 'Fermé',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  archived: {
    label: 'Archivé',
    cls: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  },
};

export const MyExams: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listTeacherExams();
      setExams(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = exams.filter((e) =>
    statusFilter === 'all' ? true : e.status === statusFilter
  );

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleStatusChange = async (examId: string, nextStatus: ExamStatus) => {
    await updateExamStatus(examId, nextStatus);
    showNotice(`État de l’examen mis à jour : ${STATUS_BADGES[nextStatus].label}`);
    await load();
  };

  return (
    <TeacherLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mes examens</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Gérez vos brouillons, vos évaluations publiées, leur clôture et leur archivage.
            </p>
          </div>
          <Link to="/professeur/examens/nouveau" className="btn-primary text-xs py-2.5">
            <FilePlus2 className="h-4 w-4" />
            <span>Créer un nouvel examen</span>
          </Link>
        </div>

        {toast && (
          <div className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow">
            {toast}
          </div>
        )}

        {/* Filtres d'état */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'draft', label: 'Brouillons' },
            { id: 'published', label: 'Publiés' },
            { id: 'closed', label: 'Fermés' },
            { id: 'archived', label: 'Archivés' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === f.id
                  ? 'bg-brand-800 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="card p-10 text-center text-sm text-slate-500">
            Chargement de vos examens...
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Aucun examen ne correspond à ce filtre.
            </p>
            <Link to="/professeur/examens/nouveau" className="btn-primary text-xs">
              Créer mon premier examen
            </Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Examen & Matière
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Classe / Durée
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Identifiant élève
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Documents PDF
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    État
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((ex) => {
                  const badge = STATUS_BADGES[ex.status];
                  return (
                    <tr key={ex.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {ex.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {ex.subject} • {ex.questions.length} question(s) • Barème /{ex.maxScore}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                        <div className="font-medium">{ex.className}</div>
                        <div>{ex.durationMinutes} min</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">
                          <span>{ex.examCode}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(ex.examCode);
                              showNotice(`Identifiant ${ex.examCode} copié.`);
                            }}
                            title="Copier l'identifiant"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <span
                          className={`mr-1.5 inline-block rounded px-1.5 py-0.5 ${
                            ex.hasSubjectPdf
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                          }`}
                        >
                          Sujet {ex.hasSubjectPdf ? '✓' : '—'}
                        </span>
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 ${
                            ex.hasCorrectionPdf
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                          }`}
                        >
                          Corrigé {ex.hasCorrectionPdf ? '✓' : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Link
                            to={`/professeur/examens/${ex.id}`}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="Modifier / Code d'accès"
                          >
                            <Edit3 className="h-4 w-4" />
                          </Link>

                          {ex.status === 'published' && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(ex.id, 'closed')}
                              className="rounded-lg border border-amber-200 p-1.5 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300"
                              title="Fermer l'examen"
                            >
                              <Lock className="h-4 w-4" />
                            </button>
                          )}

                          {ex.status !== 'archived' && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(ex.id, 'archived')}
                              className="rounded-lg border border-purple-200 p-1.5 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-300"
                              title="Archiver l'examen"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setExamToDelete(ex)}
                            className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                            title="Supprimer définitivement"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <ReauthModal
          open={Boolean(examToDelete)}
          title="Supprimer définitivement cet examen"
          description={`Vous êtes sur le point de supprimer « ${examToDelete?.title || ''} » ainsi que ses documents privés et copies associées. Confirmez votre identité pour continuer.`}
          confirmLabel="Supprimer définitivement"
          danger
          onCancel={() => setExamToDelete(null)}
          onConfirm={async (pwd) => {
            if (!examToDelete) return;
            await deleteExamWithIdentityCheck(examToDelete.id, pwd);
            setExamToDelete(null);
            showNotice('Examen et documents associés supprimés.');
            await load();
          }}
        />
      </div>
    </TeacherLayout>
  );
};
