import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  Maximize2,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { PdfViewer } from '../components/PdfViewer';
import { QuestionInput } from '../components/QuestionInput';
import {
  ExamSessionInfo,
  IntegrityEvent,
  IntegrityEventType,
  StudentAnswerValue,
} from '../types';
import {
  autosaveStudentAnswers,
  downloadStudentSubjectPdfFile,
  fetchStudentSubjectPdfBytes,
  loadLocalDraftBackup,
  loadStudentSessionCtx,
  logStudentIntegrityEvent,
  refreshStudentSession,
  saveLocalDraftBackup,
  submitFinalExamCopy,
} from '../services/submissions';

function formatCountdown(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const ExamWorkspace: React.FC = () => {
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<ExamSessionInfo | null>(null);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [subjectBytes, setSubjectBytes] = useState<Uint8Array | null>(null);

  const [answers, setAnswers] = useState<Record<string, StudentAnswerValue>>({});
  const [integrityEvents, setIntegrityEvents] = useState<IntegrityEvent[]>([]);
  const [revision, setRevision] = useState<number>(0);

  // Chronomètre contrôlé par le serveur (offset serveur immuable par rapport à performance.now())
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const deadlineLocalTargetMsRef = useRef<number | null>(null);
  const autoSubmitTriggeredRef = useRef<boolean>(false);

  // États de sauvegarde et de soumission
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [lastSavedLabel, setLastSavedLabel] = useState<string>('');
  const [integrityWarning, setIntegrityWarning] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'pdf' | 'answers'>('answers');

  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const eventsRef = useRef(integrityEvents);
  eventsRef.current = integrityEvents;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  // Initialisation et restauration de la session depuis le serveur
  useEffect(() => {
    const stored = loadStudentSessionCtx();
    if (!stored || (routeSessionId && stored.sessionId !== routeSessionId)) {
      setFatalError('Session non identifiée. Veuillez vous reconnecter depuis l’espace élève.');
      setLoading(false);
      return;
    }

    setSessionToken(stored.sessionToken);
    let active = true;

    (async () => {
      try {
        const refreshed = await refreshStudentSession(stored.sessionId, stored.sessionToken);
        if (!active) return;

        if (refreshed.status === 'submitted' && refreshed.submissionId) {
          navigate(`/eleve/resultat?submissionId=${encodeURIComponent(refreshed.submissionId)}`, {
            replace: true,
          });
          return;
        }

        // Restauration intelligente : fusion sauvegarde serveur + éventuel secours hors ligne plus récent
        const localBackup = loadLocalDraftBackup(refreshed.sessionId);
        const initialAnswers = {
          ...(refreshed.savedAnswers || {}),
          ...(localBackup?.answers || {}),
        };

        setSession(refreshed);
        setAnswers(initialAnswers);
        setIntegrityEvents(refreshed.integrityEvents || []);
        setRevision(refreshed.revision || 0);
        setRemainingSeconds(refreshed.remainingSeconds);
        deadlineLocalTargetMsRef.current = Date.now() + refreshed.remainingSeconds * 1000;
        setLastSavedLabel(new Date().toLocaleTimeString('fr-FR'));

        if (refreshed.hasSubjectPdf) {
          fetchStudentSubjectPdfBytes(refreshed.sessionId, stored.sessionToken)
            .then((pdf) => active && setSubjectBytes(pdf.bytes))
            .catch(() => {});
        }
      } catch (err) {
        if (active) {
          setFatalError(
            err instanceof Error ? err.message : 'Impossible de restaurer la session d’examen.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [routeSessionId, navigate]);

  // Sauvegarde serveur périodique + resynchronisation de l'horloge serveur
  const performAutosave = useCallback(async () => {
    if (!session || !sessionToken || submitting || autoSubmitTriggeredRef.current) return;
    setSaveState('saving');
    try {
      const res = await autosaveStudentAnswers(
        session.sessionId,
        sessionToken,
        answersRef.current,
        revisionRef.current,
        eventsRef.current
      );
      setRevision(res.revision);
      setRemainingSeconds(res.remainingSeconds);
      deadlineLocalTargetMsRef.current = Date.now() + res.remainingSeconds * 1000;
      setSaveState('saved');
      setLastSavedLabel(new Date(res.savedAt).toLocaleTimeString('fr-FR'));
    } catch {
      // Sauvegarde locale maintenue en cas de coupure réseau
      saveLocalDraftBackup(session.sessionId, answersRef.current);
      setSaveState('offline');
    }
  }, [session, sessionToken, submitting]);

  // Boucle de sauvegarde automatique selon la fréquence configurée par le professeur
  useEffect(() => {
    if (!session) return;
    const intervalSec = Math.max(10, Number(session.autoSaveIntervalSeconds || 20));
    const timer = window.setInterval(() => {
      performAutosave();
    }, intervalSec * 1000);

    const onOnline = () => performAutosave();
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [session, performAutosave]);

  // Exécution de la soumission finale (manuelle ou automatique à expiration)
  const executeFinalSubmit = useCallback(
    async (isAuto: boolean) => {
      if (!session || !sessionToken || submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const receipt = await submitFinalExamCopy(
          session.sessionId,
          sessionToken,
          answersRef.current,
          eventsRef.current,
          isAuto
        );
        sessionStorage.setItem('eduexam_last_receipt', JSON.stringify(receipt));
        navigate(`/eleve/resultat?submissionId=${encodeURIComponent(receipt.submissionId)}`, {
          replace: true,
        });
      } catch (err) {
        // Section 10 : En cas d'échec réseau, ne JAMAIS annoncer une soumission réussie !
        saveLocalDraftBackup(session.sessionId, answersRef.current);
        setSubmitError(
          err instanceof Error
            ? `La confirmation serveur n’a pas pu être obtenue (${err.message}). Vos réponses sont protégées localement : vérifiez votre connexion et cliquez sur « Réessayer la soumission sécurisée ».`
            : 'Échec réseau lors de la soumission. Vos réponses sont conservées localement.'
        );
        autoSubmitTriggeredRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [session, sessionToken, submitting, navigate]
  );

  // Décompte seconde par seconde et soumission automatique à expiration
  useEffect(() => {
    if (!session) return;
    const tick = window.setInterval(() => {
      if (deadlineLocalTargetMsRef.current === null) return;
      const rem = Math.max(0, Math.floor((deadlineLocalTargetMsRef.current - Date.now()) / 1000));
      setRemainingSeconds(rem);
      if (rem <= 0 && !autoSubmitTriggeredRef.current) {
        autoSubmitTriggeredRef.current = true;
        setConfirmModalOpen(false);
        executeFinalSubmit(true);
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [session, executeFinalSubmit]);

  // Suivi proportionné de l'intégrité (Section 9)
  useEffect(() => {
    if (!session || !session.enableIntegrityMonitoring) return;

    const recordIncident = async (type: IntegrityEventType, details: string, warningText: string) => {
      setIntegrityWarning(warningText);
      const localEv: IntegrityEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        timestamp: new Date().toISOString(),
        details,
      };
      setIntegrityEvents((prev) => [...prev, localEv]);
      await logStudentIntegrityEvent(session.sessionId, sessionToken, type, details);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        recordIncident(
          'tab_hidden',
          'Changement d’onglet ou réduction du navigateur détecté',
          'Attention : un changement d’onglet a été enregistré dans le journal de session.'
        );
      }
    };

    const onBlur = () => {
      recordIncident(
        'window_blur',
        'Perte de focus de la fenêtre d’évaluation',
        'Rappel : veuillez rester sur la fenêtre de l’évaluation jusqu’à la soumission.'
      );
    };

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        recordIncident(
          'fullscreen_exit',
          'Sortie du mode plein écran',
          'Sortie du mode plein écran enregistrée.'
        );
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [session, sessionToken]);

  const enterFullscreenWorkspace = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center space-y-2">
          <div className="text-base font-bold">Préparation sécurisée de votre copie...</div>
          <div className="text-xs text-slate-500">Synchronisation du chronomètre serveur</div>
        </div>
      </div>
    );
  }

  if (fatalError || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="card max-w-md p-6 text-center space-y-4">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-600" />
          <h1 className="text-lg font-bold">Session inaccessible</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{fatalError}</p>
          <button
            type="button"
            onClick={() => navigate('/eleve')}
            className="btn-primary w-full"
          >
            Retour à l’identification élève
          </button>
        </div>
      </div>
    );
  }

  const answeredCount = session.questions.filter((q) => {
    const a = answers[q.id];
    if (!a) return false;
    return Boolean(
      a.text?.trim() ||
        a.numericInput?.trim() ||
        a.formula?.trim() ||
        a.code?.trim() ||
        (a.selectedOptionIds && a.selectedOptionIds.length > 0) ||
        a.booleanValue === true ||
        a.booleanValue === false ||
        a.attachment ||
        (a.structuredValues && Object.values(a.structuredValues).some((v) => v?.trim())) ||
        (a.tableValues && a.tableValues.some((r) => r.some((c) => c?.trim())))
    );
  }).length;

  const isUrgent = remainingSeconds <= 300;

  return (
    <div className="flex h-screen flex-col bg-slate-100 dark:bg-slate-950">
      {/* Barre supérieure fixe : Identité, Sauvegarde, Chronomètre serveur, Soumission */}
      <header className="z-30 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
              {session.title}
            </span>
            <span className="hidden sm:inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {session.subject} • {session.student.firstName} {session.student.lastName} (
              {session.student.className})
            </span>
          </div>
          {/* Indicateur de sauvegarde */}
          <div className="mt-0.5 flex items-center gap-3 text-[11px]">
            {saveState === 'saved' && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Réponses enregistrées {lastSavedLabel ? `à ${lastSavedLabel}` : ''}
              </span>
            )}
            {saveState === 'saving' && (
              <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <RefreshCw className="h-3 w-3 animate-spin" /> Enregistrement sur le serveur...
              </span>
            )}
            {saveState === 'offline' && (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                <CloudOff className="h-3.5 w-3.5" /> Hors ligne — sauvegarde locale active
              </span>
            )}
            <button
              type="button"
              onClick={performAutosave}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Sauvegarder maintenant
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {session.enableIntegrityMonitoring && (
            <button
              type="button"
              onClick={enterFullscreenWorkspace}
              title="Activer le mode plein écran recommandé"
              className="hidden md:inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Plein écran
            </button>
          )}

          {/* Compte à rebours serveur */}
          <div
            aria-live="polite"
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 font-mono text-sm font-extrabold ${
              isUrgent
                ? 'animate-pulse border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300'
                : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>{formatCountdown(remainingSeconds)}</span>
          </div>

          {/* Bouton visible exigé Section 10 */}
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfirmModalOpen(true)}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-xs sm:text-sm py-2 px-3.5"
          >
            <Send className="h-4 w-4" />
            <span>Soumettre définitivement ma copie</span>
          </button>
        </div>
      </header>

      {/* Bandeau d'avertissement d'intégrité ou d'erreur réseau de soumission */}
      {integrityWarning && (
        <div className="flex items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-950 dark:bg-amber-950/70 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>
              {integrityWarning} ({integrityEvents.length} événement(s) signalé(s) à titre
              contextuel).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIntegrityWarning(null)}
            className="underline font-semibold"
          >
            Compris
          </button>
        </div>
      )}

      {submitError && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-600 px-4 py-2.5 text-xs font-semibold text-white">
          <span>{submitError}</span>
          <button
            type="button"
            onClick={() => executeFinalSubmit(false)}
            className="rounded-md bg-white px-3 py-1 text-red-700 font-bold"
          >
            Réessayer la soumission sécurisée
          </button>
        </div>
      )}

      {/* Sélecteur d'onglet sur petits écrans (Smartphone) */}
      <div className="grid grid-cols-2 border-b border-slate-200 bg-white text-xs font-bold lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setMobileTab('pdf')}
          className={`py-2.5 ${
            mobileTab === 'pdf'
              ? 'border-b-2 border-blue-600 text-blue-700 dark:text-blue-400'
              : 'text-slate-500'
          }`}
        >
          Sujet PDF
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('answers')}
          className={`py-2.5 ${
            mobileTab === 'answers'
              ? 'border-b-2 border-blue-600 text-blue-700 dark:text-blue-400'
              : 'text-slate-500'
          }`}
        >
          Mes réponses ({answeredCount}/{session.questions.length})
        </button>
      </div>

      {/* Espace de travail principal en deux colonnes (Section 7) */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-3 sm:p-4 lg:grid-cols-2">
        {/* Colonne gauche : Sujet PDF */}
        <div
          className={`flex flex-col overflow-hidden ${
            mobileTab === 'pdf' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <PdfViewer
            pdfBytes={subjectBytes}
            fileName={session.subjectFileName}
            allowDownload={session.allowSubjectDownload}
            onDownloadClick={() =>
              downloadStudentSubjectPdfFile(session.sessionId, sessionToken)
            }
            title="Sujet officiel de l’évaluation"
            heightClass="h-full"
          />
        </div>

        {/* Colonne droite : Saisie des réponses */}
        <div
          className={`flex flex-col overflow-y-auto space-y-4 pr-1 ${
            mobileTab === 'answers' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="card p-4 bg-blue-50/60 border-blue-200 text-xs text-slate-700 dark:bg-blue-950/20 dark:border-blue-900 dark:text-slate-300">
            <div className="flex items-center justify-between font-semibold text-blue-900 dark:text-blue-200 mb-1">
              <span>Feuille de copie numérique</span>
              <span>
                Progression : {answeredCount} / {session.questions.length} question(s) renseignée(s)
              </span>
            </div>
            <p>{session.description}</p>
          </div>

          {session.questions.length === 0 ? (
            <div className="card p-5 space-y-2">
              <label className="block text-sm font-bold">
                Rédaction libre de votre copie (en référence au sujet PDF)
              </label>
              <textarea
                rows={16}
                value={answers.free_response?.text || ''}
                onChange={(e) => {
                  const next = {
                    ...answers,
                    free_response: { text: e.target.value, updatedAt: new Date().toISOString() },
                  };
                  setAnswers(next);
                  saveLocalDraftBackup(session.sessionId, next);
                }}
                placeholder="Saisissez ici vos réponses en numérotant clairement chaque exercice et chaque question..."
                className="input-field leading-relaxed"
              />
            </div>
          ) : (
            session.questions.map((q) => (
              <QuestionInput
                key={q.id}
                question={q}
                value={answers[q.id]}
                onChange={(val) => {
                  const next = { ...answers, [q.id]: val };
                  setAnswers(next);
                  saveLocalDraftBackup(session.sessionId, next);
                }}
                allowModifyBeforeSubmit={session.allowModifyBeforeSubmit}
              />
            ))
          )}

          <div className="pt-2 pb-8 flex justify-end">
            <button
              type="button"
              onClick={() => setConfirmModalOpen(true)}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700 py-3 px-6 text-sm"
            >
              <Send className="h-4 w-4" />
              <span>Soumettre définitivement ma copie</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modale de confirmation de soumission définitive (Section 10) */}
      {confirmModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          <div className="card w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Confirmer la soumission définitive ?
            </h2>

            <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1.5 dark:bg-slate-900">
              <div>
                <strong>Questions répondues :</strong> {answeredCount} sur{' '}
                {session.questions.length}
              </div>
              <div>
                <strong>Temps restant :</strong> {formatCountdown(remainingSeconds)}
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Une fois validée, votre copie sera horodatée et verrouillée définitivement sur le
              serveur. Vous ne pourrez plus modifier vos réponses.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmModalOpen(false)}
                className="btn-secondary"
              >
                Revenir à ma copie
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => executeFinalSubmit(false)}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700"
              >
                {submitting ? 'Transmission sécurisée...' : 'Oui, soumettre ma copie'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
