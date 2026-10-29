import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  FileUp,
  KeyRound,
  Lock,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { PdfViewer } from '../components/PdfViewer';
import { QuestionBuilder } from '../components/QuestionBuilder';
import { QuestionInput } from '../components/QuestionInput';
import {
  ExamStatus,
  FullQuestionEditorItem,
  GradingMode,
  SchoolLevel,
  StudentAnswerValue,
} from '../types';
import {
  createExamDraft,
  fetchTeacherPrivatePdfBytes,
  getTeacherExamWithSecrets,
  publishExam,
  removeExamPrivatePdf,
  updateExamDraft,
  updateExamStatus,
  uploadExamPrivatePdf,
} from '../services/exams';
import { generateSampleSubjectOrCorrectionFile } from '../services/pdf';

const SUBJECT_PRESETS = [
  'Mathématiques',
  'Français',
  'Langues vivantes (Anglais / Espagnol / Allemand / Arabe)',
  'Physique-Chimie',
  'Sciences de la Vie et de la Terre (SVT)',
  'Informatique / NSI',
  'Technologie',
  'Sciences de l’ingénieur',
  'Histoire-Géographie & EMC',
  'Philosophie',
  'Économie-Gestion',
  'Formation professionnelle / Technique',
];

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export const ExamEditor: React.FC = () => {
  const { examId: routeExamId } = useParams<{ examId?: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<number>(1);
  const [examId, setExamId] = useState<string | undefined>(routeExamId);
  const [examCode, setExamCode] = useState<string>('');
  const [status, setStatus] = useState<ExamStatus>('draft');

  // Étape 1 — Informations générales
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathématiques');
  const [level, setLevel] = useState<SchoolLevel>('lycee');
  const [className, setClassName] = useState('');
  const [description, setDescription] = useState(
    'Lisez attentivement le sujet PDF dans la colonne de gauche et rédigez vos réponses dans la colonne de droite. Vos réponses sont enregistrées automatiquement.'
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [startAt, setStartAt] = useState<string>(() =>
    new Date(Date.now() - 10 * 60 * 1000).toISOString()
  );
  const [endAt, setEndAt] = useState<string>(() =>
    new Date(Date.now() + 14 * 86400 * 1000).toISOString()
  );
  const [maxScore, setMaxScore] = useState<number>(20);
  const [language, setLanguage] = useState<string>('fr');
  const [maxAttempts, setMaxAttempts] = useState<number>(1);
  const [allowModifyBeforeSubmit, setAllowModifyBeforeSubmit] = useState<boolean>(true);
  const [requireStudentEmail, setRequireStudentEmail] = useState<boolean>(false);
  const [allowSubjectDownload, setAllowSubjectDownload] = useState<boolean>(true);
  const [showScoreToStudent, setShowScoreToStudent] = useState<boolean>(true);
  const [showExpectedAnswersToStudent, setShowExpectedAnswersToStudent] =
    useState<boolean>(false);
  const [autoSaveIntervalSeconds, setAutoSaveIntervalSeconds] = useState<number>(20);
  const [enableIntegrityMonitoring, setEnableIntegrityMonitoring] = useState<boolean>(true);
  const [defaultGradingMode, setDefaultGradingMode] = useState<GradingMode>('mode_a_auto');
  const [maxPdfSizeMb, setMaxPdfSizeMb] = useState<number>(15);

  // Étape 2 & 3 — PDF Sujet & Correction
  const [hasSubjectPdf, setHasSubjectPdf] = useState(false);
  const [subjectFileName, setSubjectFileName] = useState('');
  const [subjectBytes, setSubjectBytes] = useState<Uint8Array | null>(null);
  const [subjectProgress, setSubjectProgress] = useState<number | null>(null);

  const [hasCorrectionPdf, setHasCorrectionPdf] = useState(false);
  const [correctionFileName, setCorrectionFileName] = useState('');
  const [correctionBytes, setCorrectionBytes] = useState<Uint8Array | null>(null);
  const [correctionProgress, setCorrectionProgress] = useState<number | null>(null);

  // Questions & Barème
  const [editorQuestions, setEditorQuestions] = useState<FullQuestionEditorItem[]>([]);

  // Étape 5 — Code d'accès généré
  const [generatedAccessCode, setGeneratedAccessCode] = useState<string | null>(null);
  const [accessCodeHint, setAccessCodeHint] = useState<string | undefined>();

  // États UI
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, StudentAnswerValue>>({});

  useEffect(() => {
    if (!routeExamId) return;
    let active = true;
    (async () => {
      try {
        const data = await getTeacherExamWithSecrets(routeExamId);
        if (!active) return;
        setExamId(data.id);
        setExamCode(data.examCode);
        setStatus(data.status);
        setTitle(data.title);
        setSubject(data.subject);
        setLevel(data.level);
        setClassName(data.className);
        setDescription(data.description);
        setDurationMinutes(data.durationMinutes);
        setStartAt(data.startAt);
        setEndAt(data.endAt);
        setMaxScore(data.maxScore);
        setLanguage(data.language);
        setMaxAttempts(data.maxAttempts);
        setAllowModifyBeforeSubmit(data.allowModifyBeforeSubmit);
        setRequireStudentEmail(data.requireStudentEmail);
        setAllowSubjectDownload(data.allowSubjectDownload);
        setShowScoreToStudent(data.showScoreToStudent);
        setShowExpectedAnswersToStudent(data.showExpectedAnswersToStudent);
        setAutoSaveIntervalSeconds(data.autoSaveIntervalSeconds);
        setEnableIntegrityMonitoring(data.enableIntegrityMonitoring);
        setDefaultGradingMode(data.defaultGradingMode);
        setMaxPdfSizeMb(data.maxPdfSizeMb || 15);
        setHasSubjectPdf(data.hasSubjectPdf);
        setSubjectFileName(data.subjectFileName || '');
        setHasCorrectionPdf(data.hasCorrectionPdf);
        setCorrectionFileName(data.correctionFileName || '');
        setAccessCodeHint(data.accessCodePreviewHint);

        const mergedQuestions: FullQuestionEditorItem[] = (data.questions || []).map((q) => ({
          ...q,
          rubric: data.rubrics?.[q.id] || {
            questionId: q.id,
            expectedAnswer: '',
            acceptedAlternatives: [],
            criteria: [],
          },
        }));
        setEditorQuestions(mergedQuestions);

        if (data.hasSubjectPdf) {
          fetchTeacherPrivatePdfBytes(data.id, 'subject')
            .then((b) => active && setSubjectBytes(b))
            .catch(() => {});
        }
        if (data.hasCorrectionPdf) {
          fetchTeacherPrivatePdfBytes(data.id, 'correction')
            .then((b) => active && setCorrectionBytes(b))
            .catch(() => {});
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Examen introuvable.');
      }
    })();
    return () => {
      active = false;
    };
  }, [routeExamId]);

  const ensureExamSaved = async (): Promise<string> => {
    if (!title.trim() || !className.trim()) {
      throw new Error(
        'Veuillez renseigner au minimum le titre de l’examen et la classe à l’étape 1.'
      );
    }
    const payload = {
      title,
      subject,
      level,
      className,
      description,
      durationMinutes,
      startAt,
      endAt,
      maxScore,
      language,
      maxAttempts,
      allowModifyBeforeSubmit,
      requireStudentEmail,
      allowSubjectDownload,
      showScoreToStudent,
      showExpectedAnswersToStudent,
      autoSaveIntervalSeconds,
      enableIntegrityMonitoring,
      defaultGradingMode,
      maxPdfSizeMb,
      editorQuestions,
    };

    if (!examId) {
      const created = await createExamDraft(payload);
      setExamId(created.id);
      setExamCode(created.examCode);
      setStatus(created.status);
      navigate(`/professeur/examens/${created.id}`, { replace: true });
      return created.id;
    } else {
      const updated = await updateExamDraft(examId, payload);
      setExamCode(updated.examCode);
      return updated.id;
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const id = await ensureExamSaved();
      if (status !== 'draft') {
        await updateExamStatus(id, 'draft');
        setStatus('draft');
      }
      setNotice('Examen enregistré comme brouillon.');
      setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const handlePdfUpload = async (kind: 'subject' | 'correction', file: File) => {
    setError(null);
    try {
      const id = await ensureExamSaved();
      if (kind === 'subject') setSubjectProgress(1);
      else setCorrectionProgress(1);

      const res = await uploadExamPrivatePdf(id, kind, file, maxPdfSizeMb, (pct) => {
        if (kind === 'subject') setSubjectProgress(pct);
        else setCorrectionProgress(pct);
      });

      const rawBuf = new Uint8Array(await file.arrayBuffer());
      if (kind === 'subject') {
        setHasSubjectPdf(true);
        setSubjectFileName(res.fileName);
        setSubjectBytes(rawBuf);
        setTimeout(() => setSubjectProgress(null), 1200);
      } else {
        setHasCorrectionPdf(true);
        setCorrectionFileName(res.fileName);
        setCorrectionBytes(rawBuf);
        setTimeout(() => setCorrectionProgress(null), 1200);
      }
      setNotice(
        kind === 'subject'
          ? 'Sujet PDF importé dans votre stockage privé.'
          : 'Corrigé officiel PDF importé dans le coffre confidentiel.'
      );
      setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setSubjectProgress(null);
      setCorrectionProgress(null);
      setError(err instanceof Error ? err.message : 'Échec de l’importation PDF.');
    }
  };

  const handleRemovePdf = async (kind: 'subject' | 'correction') => {
    if (!examId) return;
    try {
      await removeExamPrivatePdf(examId, kind);
      if (kind === 'subject') {
        setHasSubjectPdf(false);
        setSubjectFileName('');
        setSubjectBytes(null);
      } else {
        setHasCorrectionPdf(false);
        setCorrectionFileName('');
        setCorrectionBytes(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer le fichier.');
    }
  };

  const handlePublish = async (regenerateCode = false) => {
    setSaving(true);
    setError(null);
    try {
      const id = await ensureExamSaved();
      const pub = await publishExam(id, regenerateCode);
      setExamCode(pub.examCode);
      setStatus(pub.status);
      if (pub.accessCode) setGeneratedAccessCode(pub.accessCode);
      if (pub.accessCodePreviewHint) setAccessCodeHint(pub.accessCodePreviewHint);
      setNotice('Examen publié avec succès ! Transmettez l’identifiant et le code à vos élèves.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publication impossible.');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseExam = async () => {
    if (!examId) return;
    setSaving(true);
    try {
      await updateExamStatus(examId, 'closed');
      setStatus('closed');
      setNotice('L’examen est désormais fermé aux nouvelles participations.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la fermeture.');
    } finally {
      setSaving(false);
    }
  };

  const totalQuestionPoints = editorQuestions.reduce((acc, q) => acc + q.maxPoints, 0);

  const stepsMeta = [
    { num: 1, title: 'Informations générales' },
    { num: 2, title: 'Sujet PDF privé' },
    { num: 3, title: 'Correction PDF & Questions' },
    { num: 4, title: 'Configuration du barème' },
    { num: 5, title: 'Code d’accès & Publication' },
  ];

  return (
    <TeacherLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* En-tête de l'assistant */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {examId ? `Édition de l’examen : ${title || 'Sans titre'}` : 'Créer un nouvel examen'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Assistant structuré en 5 étapes — stockage privé, barème sur mesure et code individuel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              className="btn-secondary text-xs py-2"
            >
              <Save className="h-4 w-4" />
              <span>Enregistrer comme brouillon</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="btn-secondary text-xs py-2"
            >
              <Eye className="h-4 w-4" />
              <span>Prévisualiser l’examen</span>
            </button>
          </div>
        </div>

        {/* Barre de progression des 5 étapes */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stepsMeta.map((s) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                  active
                    ? 'border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                    : done
                    ? 'border-emerald-200 bg-white text-slate-700 dark:border-emerald-900/50 dark:bg-slate-900 dark:text-slate-200'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    active
                      ? 'bg-blue-600 text-white'
                      : done
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : s.num}
                </span>
                <span className="truncate text-xs font-semibold">{s.title}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
            {notice}
          </div>
        )}

        {/* ================================================================ */}
        {/* ÉTAPE 1 : INFORMATIONS GÉNÉRALES                                 */}
        {/* ================================================================ */}
        {step === 1 && (
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-bold">Étape 1 — Informations générales et paramètres</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1">Titre de l’examen *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Devoir Surveillé n°3 — Analyse, Cinématique et Algorithmique"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Matière / Discipline *</label>
                <input
                  list="eduexam-subjects"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Sélectionnez ou saisissez une matière"
                  className="input-field"
                />
                <datalist id="eduexam-subjects">
                  {SUBJECT_PRESETS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Niveau scolaire *</label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as SchoolLevel)}
                  className="input-field"
                >
                  <option value="primaire">École primaire</option>
                  <option value="college">Collège (6e – 3e)</option>
                  <option value="lycee">Lycée général, technologique ou professionnel</option>
                  <option value="superieur">Enseignement supérieur (Université, CPGE, BTS, IUT)</option>
                  <option value="formation_pro">Formation professionnelle / Continue</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Classe ou groupe *</label>
                <input
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="Ex: Terminale S2, 3ème A, L1 Informatique..."
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Langue de l’évaluation</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="input-field"
                >
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                  <option value="ar">Arabe</option>
                  <option value="es">Espagnol</option>
                  <option value="de">Allemand</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1">
                  Description et consignes officielles
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Durée de l’épreuve (minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Note maximale de référence (normalisée sur 20 dans les bilans)
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxScore}
                  onChange={(e) => setMaxScore(Number(e.target.value))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Date et heure d’ouverture</label>
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(startAt)}
                  onChange={(e) =>
                    e.target.value && setStartAt(new Date(e.target.value).toISOString())
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Date et heure de clôture</label>
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(endAt)}
                  onChange={(e) =>
                    e.target.value && setEndAt(new Date(e.target.value).toISOString())
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Nombre de tentatives autorisées par élève
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Fréquence de sauvegarde automatique (secondes)
                </label>
                <input
                  type="number"
                  min={10}
                  max={120}
                  value={autoSaveIntervalSeconds}
                  onChange={(e) => setAutoSaveIntervalSeconds(Number(e.target.value))}
                  className="input-field"
                />
              </div>
            </div>

            {/* Options de comportement & restitution */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowModifyBeforeSubmit}
                  onChange={(e) => setAllowModifyBeforeSubmit(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Autoriser la modification des réponses</strong> jusqu’à la soumission
                  définitive de la copie.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showScoreToStudent}
                  onChange={(e) => setShowScoreToStudent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Afficher la note à l’élève</strong> après correction / validation de la
                  copie.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExpectedAnswersToStudent}
                  onChange={(e) => setShowExpectedAnswersToStudent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Autoriser la consultation des éléments attendus</strong> une fois la note
                  restituée (jamais pendant l’épreuve).
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSubjectDownload}
                  onChange={(e) => setAllowSubjectDownload(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Autoriser le téléchargement du sujet PDF</strong> par l’élève.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireStudentEmail}
                  onChange={(e) => setRequireStudentEmail(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Exiger l’adresse e-mail de l’élève</strong> lors de l’identification.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableIntegrityMonitoring}
                  onChange={(e) => setEnableIntegrityMonitoring(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-600"
                />
                <span>
                  <strong>Activer le suivi proportionné d’intégrité</strong> (changements d’onglet,
                  perte de focus, plein écran).
                </span>
              </label>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* ÉTAPE 2 : IMPORTATION DU SUJET PDF PRIVÉ                         */}
        {/* ================================================================ */}
        {step === 2 && (
          <div className="card p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Étape 2 — Importation du sujet PDF</h2>
                <p className="text-xs text-slate-500">
                  Stocké dans un coffre privé : aucune URL publique permanente n’est créée.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span>Taille max (Mo) :</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={maxPdfSizeMb}
                  onChange={(e) => setMaxPdfSizeMb(Number(e.target.value))}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-center dark:border-slate-700 dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => {
                    const f = generateSampleSubjectOrCorrectionFile(
                      'subject',
                      title || 'Évaluation',
                      subject,
                      className || 'Classe'
                    );
                    handlePdfUpload('subject', f);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Importer un sujet PDF modèle
                </button>
              </div>
            </div>

            {/* Zone Glisser-Déposer */}
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handlePdfUpload('subject', file);
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 p-8 text-center transition hover:border-blue-600 dark:border-slate-700 dark:bg-slate-900/50"
            >
              <FileUp className="h-8 w-8 text-blue-600 mb-2" />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Glissez-déposez votre sujet PDF ici ou cliquez pour parcourir votre ordinateur
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Format PDF vérifié (%PDF-) • Taille maximale : {maxPdfSizeMb} Mo
              </span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePdfUpload('subject', file);
                }}
                className="hidden"
              />
            </label>

            {subjectProgress !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-blue-700">
                  <span>Transfert sécurisé en cours...</span>
                  <span>{subjectProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${subjectProgress}%` }}
                  />
                </div>
              </div>
            )}

            {hasSubjectPdf && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 font-semibold">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span>{subjectFileName || 'Sujet.pdf'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePdf('subject')}
                  className="inline-flex items-center gap-1 text-red-600 hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer le sujet
                </button>
              </div>
            )}

            <PdfViewer
              pdfBytes={subjectBytes}
              fileName={subjectFileName || 'Sujet.pdf'}
              allowDownload={true}
              title={subjectFileName ? `Aperçu du sujet : ${subjectFileName}` : 'Aperçu du sujet PDF'}
              heightClass="h-[520px]"
            />
          </div>
        )}

        {/* ================================================================ */}
        {/* ÉTAPE 3 : IMPORTATION DE LA CORRECTION PDF & QUESTIONS           */}
        {/* ================================================================ */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">
                    Étape 3 — Corrigé officiel PDF (Strictement confidentiel)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Ce fichier reste exclusivement accessible à votre compte professeur. Il n’est
                    jamais envoyé au navigateur de l’élève.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const f = generateSampleSubjectOrCorrectionFile(
                      'correction',
                      title || 'Évaluation',
                      subject,
                      className || 'Classe'
                    );
                    handlePdfUpload('correction', f);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Importer un corrigé PDF modèle
                </button>
              </div>

              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handlePdfUpload('correction', file);
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/30 p-6 text-center transition hover:border-emerald-600 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <Lock className="h-7 w-7 text-emerald-600 mb-1.5" />
                <span className="text-sm font-semibold">
                  Importer ou glisser-déposer le corrigé officiel PDF (confidentiel)
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload('correction', file);
                  }}
                  className="hidden"
                />
              </label>

              {correctionProgress !== null && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-emerald-600 transition-all"
                    style={{ width: `${correctionProgress}%` }}
                  />
                </div>
              )}

              {hasCorrectionPdf && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                    <span className="font-semibold">
                      Corrigé confidentiel importé : {correctionFileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePdf('correction')}
                      className="text-red-600 hover:underline"
                    >
                      Supprimer
                    </button>
                  </div>
                  <PdfViewer
                    pdfBytes={correctionBytes}
                    fileName={correctionFileName || 'Correction.pdf'}
                    allowDownload={true}
                    title="Aperçu confidentiel du corrigé PDF"
                    heightClass="h-[400px]"
                  />
                </div>
              )}
            </div>

            <div className="card p-6 space-y-4">
              <h3 className="text-base font-bold">
                Association des questions, types de réponses et réponses attendues
              </h3>
              <QuestionBuilder
                questions={editorQuestions}
                defaultGradingMode={defaultGradingMode}
                onChange={setEditorQuestions}
              />
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* ÉTAPE 4 : CONFIGURATION DU BARÈME (MODES A, B, C)                */}
        {/* ================================================================ */}
        {step === 4 && (
          <div className="card p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold">Étape 4 — Configuration du mode de barème</h2>
              <p className="text-xs text-slate-500">
                Choisissez le mode par défaut ou ajustez individuellement le mode de chaque question.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  mode: 'mode_a_auto' as GradingMode,
                  title: 'Mode A — Correction automatique',
                  desc: 'Pour QCM, Vrai/Faux, réponses numériques avec tolérance/unité, formules ou textes courts objectivement définis.',
                },
                {
                  mode: 'mode_b_assisted' as GradingMode,
                  title: 'Mode B — Correction assistée',
                  desc: 'Pour questions ouvertes, rédactions, démonstrations et code. Grille de critères et pré-évaluation indicative soumise à validation humaine.',
                },
                {
                  mode: 'mode_c_manual' as GradingMode,
                  title: 'Mode C — Correction manuelle',
                  desc: 'Vous consultez chaque copie en regard de votre corrigé PDF et attribuez directement les points et commentaires.',
                },
              ].map((card) => {
                const selected = defaultGradingMode === card.mode;
                return (
                  <div
                    key={card.mode}
                    onClick={() => setDefaultGradingMode(card.mode)}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition ${
                      selected
                        ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/40'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-800'
                    }`}
                  >
                    <h3 className="text-sm font-bold">{card.title}</h3>
                    <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {card.desc}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDefaultGradingMode(card.mode);
                        setEditorQuestions((prev) =>
                          prev.map((q) => ({ ...q, gradingMode: card.mode }))
                        );
                        setNotice(`Mode appliqué aux ${editorQuestions.length} question(s).`);
                      }}
                      className="mt-3 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
                    >
                      Appliquer à toutes les questions
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="space-y-1 text-sm">
                <div>
                  <strong>Nombre de questions configurées :</strong> {editorQuestions.length}
                </div>
                <div>
                  <strong>Somme des points des questions :</strong> {totalQuestionPoints} pt(s) —{' '}
                  <span className="text-slate-500">
                    Normalisation automatique sur /{maxScore} et sur /20 lors du calcul des notes.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="btn-secondary text-xs py-2"
              >
                Modifier le détail des questions
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* ÉTAPE 5 : CODE D'ACCÈS CRYPTOGRAPHIQUE & PUBLICATION             */}
        {/* ================================================================ */}
        {step === 5 && (
          <div className="card p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold">
                Étape 5 — Génération du code d’accès et publication
              </h2>
              <p className="text-xs text-slate-500">
                Lors de la publication, le serveur génère un code d’accès cryptographiquement sûr et
                ne stocke que son empreinte salée.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Identifiant unique de l’examen</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
                  {examCode || 'Généré à l’enregistrement'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs text-slate-500">Code d’accès / Mot de passe élève</div>
                <div className="mt-1 font-mono text-base font-bold text-emerald-700 dark:text-emerald-400">
                  {generatedAccessCode
                    ? generatedAccessCode
                    : accessCodeHint
                    ? `${accessCodeHint} (protégé)`
                    : 'Généré à la publication'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-xs text-slate-500">État actuel & Expiration</div>
                <div className="mt-1 text-sm font-bold capitalize">
                  {status === 'published'
                    ? 'Publié (ouvert aux élèves)'
                    : status === 'closed'
                    ? 'Fermé'
                    : status === 'archived'
                    ? 'Archivé'
                    : 'Brouillon'}
                </div>
                <div className="text-[11px] text-slate-500">
                  Expire le {new Date(endAt).toLocaleString('fr-FR')}
                </div>
              </div>
            </div>

            {generatedAccessCode && (
              <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50/70 p-4 space-y-2 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  <KeyRound className="h-4 w-4" />
                  <span>Identifiants à transmettre à votre classe ({className}) :</span>
                </div>
                <p className="font-mono text-sm text-slate-900 dark:text-white">
                  Identifiant de l’examen : <strong>{examCode}</strong> &nbsp;|&nbsp; Mot de passe :{' '}
                  <strong>{generatedAccessCode}</strong>
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Conservez ce code : pour votre sécurité, seule son empreinte chiffrée est stockée
                  sur le serveur. Vous pouvez toutefois en régénérer un nouveau à tout moment.
                </p>
              </div>
            )}

            {/* Les 5 boutons exigés à l'Étape 5 */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveDraft}
                className="btn-secondary"
              >
                <Save className="h-4 w-4" />
                <span>Enregistrer comme brouillon</span>
              </button>

              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="btn-secondary"
              >
                <Eye className="h-4 w-4" />
                <span>Prévisualiser l’examen</span>
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => handlePublish(false)}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700"
              >
                <Send className="h-4 w-4" />
                <span>Publier l’examen</span>
              </button>

              <button
                type="button"
                disabled={!generatedAccessCode && !examCode}
                onClick={() => {
                  const textToCopy = generatedAccessCode
                    ? `Examen : ${title}\nIdentifiant : ${examCode}\nMot de passe : ${generatedAccessCode}`
                    : examCode;
                  navigator.clipboard?.writeText(textToCopy);
                  setNotice('Informations d’accès copiées dans le presse-papiers.');
                }}
                className="btn-secondary"
              >
                <Copy className="h-4 w-4" />
                <span>Copier le code d’accès</span>
              </button>

              {status === 'published' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handlePublish(true)}
                  className="btn-secondary"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Régénérer un nouveau code</span>
                </button>
              )}

              <button
                type="button"
                disabled={!examId || saving}
                onClick={handleCloseExam}
                className="btn-danger"
              >
                <Lock className="h-4 w-4" />
                <span>Fermer l’examen</span>
              </button>
            </div>
          </div>
        )}

        {/* Navigation bas de page entre étapes */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={step <= 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="btn-secondary"
          >
            <ChevronLeft className="h-4 w-4" /> Étape précédente
          </button>

          {step < 5 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(5, s + 1))}
              className="btn-primary"
            >
              Étape suivante <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="h-4 w-4" /> Prêt pour la diffusion à vos élèves
            </div>
          )}
        </div>
      </div>

      {/* Modale de Prévisualisation Élève */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 p-3 sm:p-6 backdrop-blur-sm">
          <div className="card flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-brand-900 px-5 py-3 text-white dark:border-slate-800">
              <div>
                <span className="rounded bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-950 mr-2">
                  APERÇU VUE ÉLÈVE
                </span>
                <span className="font-bold text-sm">{title || 'Examen sans titre'}</span>
                <span className="ml-2 text-xs text-blue-200">
                  ({subject} • {durationMinutes} min • Le corrigé PDF n’apparaît jamais ici)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
              <PdfViewer
                pdfBytes={subjectBytes}
                fileName={subjectFileName || 'Sujet.pdf'}
                allowDownload={allowSubjectDownload}
                title="Colonne gauche : Sujet PDF"
                heightClass="h-[540px]"
              />
              <div className="space-y-4 overflow-y-auto pr-1">
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                  <strong>Consignes :</strong> {description}
                </div>
                {editorQuestions.map((q) => (
                  <QuestionInput
                    key={q.id}
                    question={q}
                    value={previewAnswers[q.id]}
                    onChange={(val) =>
                      setPreviewAnswers((prev) => ({ ...prev, [q.id]: val }))
                    }
                    allowModifyBeforeSubmit={allowModifyBeforeSubmit}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
};
