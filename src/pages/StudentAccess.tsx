import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  Clock,
  Download,
  Eye,
  KeyRound,
  Play,
  Shield,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { PdfViewer } from '../components/PdfViewer';
import { ExamSessionInfo } from '../types';
import {
  downloadStudentSubjectPdfFile,
  fetchStudentSubjectPdfBytes,
  startStudentExam,
  verifyStudentAccess,
} from '../services/submissions';

export const StudentAccess: React.FC = () => {
  const navigate = useNavigate();

  // Formulaire d'identification (Section 6.1)
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [className, setClassName] = useState('');
  const [examCode, setExamCode] = useState('');
  const [accessCode, setAccessCode] = useState('');

  // Session autorisée avant ou en cours de démarrage (Section 6.2 & 6.3)
  const [session, setSession] = useState<ExamSessionInfo | null>(null);
  const [onlinePdfOpen, setOnlinePdfOpen] = useState(false);
  const [subjectBytes, setSubjectBytes] = useState<Uint8Array | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerifyAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const info = await verifyStudentAccess({
        firstName,
        lastName,
        email,
        className,
        examCode,
        accessCode,
      });
      setSession(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accès refusé.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConsultOnline = async () => {
    if (!session) return;
    setOnlinePdfOpen((prev) => !prev);
    if (!subjectBytes && session.hasSubjectPdf) {
      setLoadingPdf(true);
      try {
        const res = await fetchStudentSubjectPdfBytes(session.sessionId, session.sessionToken);
        setSubjectBytes(res.bytes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible de charger le sujet en ligne.');
      } finally {
        setLoadingPdf(false);
      }
    }
  };

  const handleDownloadSubject = async () => {
    if (!session) return;
    try {
      await downloadStudentSubjectPdfFile(session.sessionId, session.sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement non autorisé.');
    }
  };

  const handleStartExam = async () => {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      await startStudentExam(session.sessionId, session.sessionToken);
      navigate(`/examen/${encodeURIComponent(session.sessionId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer l’évaluation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        {!session ? (
          <div className="mx-auto max-w-xl space-y-6">
            <div className="text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow">
                <BookOpen className="h-6 w-6" />
              </div>
              <h1 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
                Accès Élève à une Évaluation
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Renseignez votre identité ainsi que l’identifiant et le mot de passe transmis par
                votre enseignant.
              </p>
            </div>

            <div className="card p-6 sm:p-8">
              {error && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleVerifyAccess} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Nom *</label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Votre nom de famille"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Prénom *</label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Votre prénom"
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Classe ou groupe *</label>
                    <input
                      type="text"
                      required
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="Ex: Terminale S1, 3e B..."
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Adresse e-mail (si demandée)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="eleve@ecole.edu"
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Identifiant de l’examen *
                    </label>
                    <input
                      type="text"
                      required
                      value={examCode}
                      onChange={(e) => setExamCode(e.target.value.toUpperCase())}
                      placeholder="Ex: EXM-2026-XXXXXX"
                      className="input-field font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Mot de passe de l’examen *
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={accessCode}
                        onChange={(e) => setAccessCode(e.target.value)}
                        placeholder="XXXX-XXXX-XXXX"
                        className="input-field pl-9 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 flex items-start gap-2 dark:bg-slate-900 dark:text-slate-400">
                  <Shield className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                  <span>
                    Information transparence : seules votre identité scolaire, vos réponses, les
                    horodatages et les événements techniques de fenêtre (changement d’onglet / perte
                    de focus) sont enregistrés aux fins d’évaluation par votre enseignant.
                  </span>
                </div>

                <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                  {submitting ? 'Vérification de votre accès...' : 'Vérifier l’accès à l’évaluation'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* Salle de pré-démarrage autorisée (Sections 6.2 & 6.3) */
          <div className="space-y-6">
            <div className="card p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
                <div>
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Accès vérifié — Candidat : {session.student.firstName} {session.student.lastName}
                  </span>
                  <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                    {session.title}
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Matière : <strong>{session.subject}</strong> • Classe :{' '}
                    <strong>{session.className}</strong> • Tentative n°{session.attemptNumber}
                  </p>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-right dark:border-blue-800 dark:bg-blue-950/50">
                  <div className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center justify-end gap-1">
                    <Clock className="h-3.5 w-3.5" /> Durée officielle
                  </div>
                  <div className="text-xl font-extrabold text-blue-900 dark:text-white">
                    {session.durationMinutes} min
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    Temps disponible : {Math.ceil(session.remainingSeconds / 60)} min
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Détails et consignes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/70">
                  <div className="text-xs text-slate-500">Questions structurées</div>
                  <div className="mt-1 text-lg font-bold">
                    {session.questionCount > 0 ? `${session.questionCount} question(s)` : 'Réponse libre'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/70">
                  <div className="text-xs text-slate-500">Barème de notation</div>
                  <div className="mt-1 text-lg font-bold">Sur {session.maxScore} points</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/70">
                  <div className="text-xs text-slate-500">Modification avant soumission</div>
                  <div className="mt-1 text-sm font-bold">
                    {session.allowModifyBeforeSubmit ? 'Autorisée' : 'Verrouillée par question'}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                <div className="font-bold mb-1">Consignes de l’épreuve :</div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {session.description || 'Respectez le temps imparti et vérifiez vos réponses avant soumission.'}
                </p>
              </div>

              {/* Section 6.2 : Télécharger ou Consulter le sujet PDF en ligne */}
              {session.hasSubjectPdf && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {session.allowSubjectDownload && (
                    <button
                      type="button"
                      onClick={handleDownloadSubject}
                      className="btn-secondary"
                    >
                      <Download className="h-4 w-4 text-blue-600" />
                      <span>Télécharger le sujet PDF</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleConsultOnline}
                    className="btn-secondary"
                  >
                    <Eye className="h-4 w-4 text-blue-600" />
                    <span>Consulter le sujet en ligne</span>
                  </button>
                </div>
              )}

              {onlinePdfOpen && (
                <div className="pt-2">
                  {loadingPdf ? (
                    <div className="p-6 text-center text-sm text-slate-500">
                      Ouverture temporaire sécurisée du sujet PDF...
                    </div>
                  ) : (
                    <PdfViewer
                      pdfBytes={subjectBytes}
                      fileName={session.subjectFileName}
                      allowDownload={session.allowSubjectDownload}
                      onDownloadClick={handleDownloadSubject}
                      title="Consultation sécurisée du sujet PDF"
                      heightClass="h-[480px]"
                    />
                  )}
                </div>
              )}

              {/* Section 6.3 : Bouton Commencer l'évaluation */}
              <div className="border-t border-slate-200 pt-5 flex flex-wrap items-center justify-between gap-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 max-w-md">
                  Dès votre clic sur le bouton ci-contre, l’heure officielle de démarrage est
                  scellée sur le serveur et le compte à rebours démarre.
                </p>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleStartExam}
                  className="btn-primary px-6 py-3 text-base bg-emerald-600 hover:bg-emerald-700"
                >
                  <Play className="h-5 w-5" />
                  <span>
                    {session.status === 'in_progress'
                      ? 'Reprendre mon évaluation en cours'
                      : 'Commencer l’évaluation'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
