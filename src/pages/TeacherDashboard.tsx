import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Award,
  CheckCircle2,
  ClipboardList,
  Clock,
  FilePlus2,
  FolderCheck,
  Layers,
  Percent,
  RefreshCw,
} from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { DashboardMetrics } from '../types';
import { fetchDashboardMetrics } from '../services/exams';
import { useAuth } from '../context/AuthContext';

export const TeacherDashboard: React.FC = () => {
  const { teacher } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardMetrics();
      setMetrics(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement du tableau de bord.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const statCards = metrics
    ? [
        {
          label: 'Total examens créés',
          value: metrics.totalExams,
          icon: Layers,
          color: 'text-blue-700 bg-blue-50 dark:bg-blue-950/60 dark:text-blue-300',
        },
        {
          label: 'Examens publiés',
          value: metrics.publishedExams,
          icon: CheckCircle2,
          color: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300',
        },
        {
          label: 'Examens en cours',
          value: metrics.activeExamsNow,
          icon: Activity,
          color: 'text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-300',
        },
        {
          label: 'Examens terminés',
          value: metrics.finishedExams,
          icon: FolderCheck,
          color: 'text-slate-700 bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
        },
        {
          label: 'Copies reçues',
          value: metrics.totalSubmissions,
          icon: ClipboardList,
          color: 'text-amber-700 bg-amber-50 dark:bg-amber-950/60 dark:text-amber-300',
        },
        {
          label: 'Moyenne globale (/20)',
          value: metrics.globalAverageOn20 !== null ? `${metrics.globalAverageOn20} / 20` : '—',
          icon: Award,
          color: 'text-purple-700 bg-purple-50 dark:bg-purple-950/60 dark:text-purple-300',
        },
        {
          label: 'Taux de réussite (≥ 10/20)',
          value: metrics.passRatePercent !== null ? `${metrics.passRatePercent}%` : '—',
          icon: Percent,
          color: 'text-teal-700 bg-teal-50 dark:bg-teal-950/60 dark:text-teal-300',
        },
      ]
    : [];

  return (
    <TeacherLayout>
      <div className="space-y-6">
        {/* En-tête */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Bonjour, {teacher?.firstName} {teacher?.lastName}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Vue d’ensemble en temps réel de vos évaluations, copies reçues et performances.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={loadData}
              className="btn-secondary text-xs py-2"
              title="Actualiser les données"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
            <Link to="/professeur/examens/nouveau" className="btn-primary text-xs py-2">
              <FilePlus2 className="h-4 w-4" />
              <span>Créer un examen</span>
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && !metrics ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="card h-28 animate-pulse bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : (
          metrics && (
            <>
              {/* Grille des 7 indicateurs principaux */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {statCards.map((sc) => {
                  const Icon = sc.icon;
                  return (
                    <div key={sc.label} className="card p-5 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {sc.label}
                        </p>
                        <p className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">
                          {sc.value}
                        </p>
                      </div>
                      <div className={`rounded-xl p-3 ${sc.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Deux panneaux : Moyenne par examen & Dernières soumissions */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Moyenne par examen */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Moyenne et réussite par examen
                    </h2>
                    <Link
                      to="/professeur/examens"
                      className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Voir tous mes examens
                    </Link>
                  </div>

                  {metrics.examAverages.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                      Aucun examen créé pour le moment. Cliquez sur « Créer un examen » pour commencer.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {metrics.examAverages.slice(0, 6).map((ex) => (
                        <div
                          key={ex.examId}
                          className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm"
                        >
                          <div className="min-w-0">
                            <Link
                              to={`/professeur/examens/${ex.examId}`}
                              className="block truncate font-semibold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                            >
                              {ex.title}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {ex.subject} • {ex.className} • Code :{' '}
                              <span className="font-mono">{ex.examCode}</span>
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {ex.averageOn20 !== null ? `${ex.averageOn20} / 20` : '—'}
                            </div>
                            <div className="text-xs text-slate-500">
                              {ex.submissionCount} copie{ex.submissionCount > 1 ? 's' : ''}
                              {ex.passRatePercent !== null ? ` • ${ex.passRatePercent}% réussite` : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dernières soumissions */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Dernières soumissions reçues
                    </h2>
                    <Link
                      to="/professeur/copies"
                      className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Ouvrir la gestion des copies
                    </Link>
                  </div>

                  {metrics.recentSubmissions.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                      Aucune copie reçue pour l’instant. Les soumissions apparaîtront ici dès validation
                      par vos élèves.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {metrics.recentSubmissions.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900 dark:text-white">
                              {sub.student.lastName.toUpperCase()} {sub.student.firstName}{' '}
                              <span className="text-xs font-normal text-slate-500">
                                ({sub.student.className})
                              </span>
                            </p>
                            <p className="truncate text-xs text-slate-500 flex items-center gap-1.5">
                              <Clock className="h-3 w-3" />
                              {new Date(sub.submittedAt).toLocaleString('fr-FR', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}{' '}
                              • {sub.examTitle}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                sub.gradingStatus === 'pending_review'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {sub.gradingStatus === 'pending_review'
                                ? 'À corriger'
                                : `${sub.normalizedScoreOn20}/20`}
                            </span>
                            <Link
                              to={`/professeur/copies?submissionId=${encodeURIComponent(sub.id)}`}
                              className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Ouvrir
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        )}
      </div>
    </TeacherLayout>
  );
};
