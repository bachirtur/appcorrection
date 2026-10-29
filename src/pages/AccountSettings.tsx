import React, { useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  GitBranch,
  KeyRound,
  Link2,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { TeacherLayout } from '../components/TeacherLayout';
import { useAuth } from '../context/AuthContext';
import { changeTeacherPassword, updateTeacherProfile } from '../services/auth';
import {
  clearCustomFirebaseWebConfig,
  FIREBASE_CONSOLE_PROJECT_URL,
  getActiveBackendMode,
  getEffectiveFirebaseConfig,
  isFirebaseConfigured,
  parseFirebaseConfigSnippet,
  saveCustomFirebaseWebConfig,
} from '../services/firebase';

export const AccountSettings: React.FC = () => {
  const { teacher, refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState(teacher?.firstName || '');
  const [lastName, setLastName] = useState(teacher?.lastName || '');
  const [institution, setInstitution] = useState(teacher?.institution || '');
  const [defaultSubject, setDefaultSubject] = useState(teacher?.defaultSubject || '');
  const [retentionDays, setRetentionDays] = useState(teacher?.retentionDays || 365);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [showFirebaseBox, setShowFirebaseBox] = useState(false);
  const [firebaseSnippet, setFirebaseSnippet] = useState('');

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await updateTeacherProfile({
        firstName,
        lastName,
        institution,
        defaultSubject,
        retentionDays,
      });
      await refreshProfile();
      setMsg('Vos paramètres professionnels et de conservation ont été mis à jour.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await changeTeacherPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setMsg('Mot de passe mis à jour après vérification de votre identité.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Échec du changement de mot de passe.');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectFirebase = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const parsed = parseFirebaseConfigSnippet(firebaseSnippet);
      saveCustomFirebaseWebConfig(parsed);
      setFirebaseSnippet('');
      setShowFirebaseBox(false);
      setMsg(
        `Projet Firebase "${parsed.projectId}" connecté avec succès sans ligne de commande. Rechargement en cours...`
      );
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Format firebaseConfig non reconnu.');
    }
  };

  const handleDisconnectFirebase = () => {
    clearCustomFirebaseWebConfig();
    window.location.reload();
  };

  const mode = getActiveBackendMode();
  const fbReady = isFirebaseConfigured();
  const effectiveCfg = getEffectiveFirebaseConfig();

  return (
    <TeacherLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Paramètres du compte, Cloud & Liens directs
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Votre application est immédiatement opérationnelle sans configuration manuelle. Retrouvez
            ici vos accès directs GitHub et Firebase.
          </p>
        </div>

        {msg && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span>{msg}</span>
          </div>
        )}

        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {err}
          </div>
        )}

        {/* Carte Cloud & Liens directs GitHub + Firebase appcorrection */}
        <div className="card p-6 space-y-4 border-l-4 border-l-emerald-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-base font-bold">
              <Cloud className="h-5 w-5 text-emerald-600" />
              <span>Infrastructure Cloud prête à l’emploi ({effectiveCfg.projectId})</span>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              {mode === 'firebase'
                ? `Connecté à Firebase (${effectiveCfg.projectId})`
                : 'Opérationnel immédiatement — Serveur Cloud sécurisé actif'}
            </span>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {fbReady
              ? `Votre projet Firebase "${effectiveCfg.projectId}" est directement actif dans ce navigateur.`
              : 'Aucune tâche manuelle ni commande terminal n’est requise : vous pouvez créer vos examens, importer vos sujets PDF et faire composer vos élèves dès maintenant.'}
          </p>

          {/* Liens directs cliquables vers GitHub et Console Firebase */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <a
              href="https://github.com/bachirtur/appcorrection"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs"
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>Dépôt GitHub (bachirtur/appcorrection)</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>

            <a
              href={FIREBASE_CONSOLE_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs"
            >
              <Cloud className="h-3.5 w-3.5 text-amber-600" />
              <span>Ouvrir ma Console Firebase « appcorrection »</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>

            {!fbReady ? (
              <button
                type="button"
                onClick={() => setShowFirebaseBox((v) => !v)}
                className="btn-primary text-xs"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Relier Firebase « appcorrection » en 1 clic (optionnel)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDisconnectFirebase}
                className="btn-secondary text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Revenir au serveur Cloud intégré</span>
              </button>
            )}
          </div>

          {showFirebaseBox && !fbReady && (
            <form
              onSubmit={handleConnectFirebase}
              className="mt-3 space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30"
            >
              <div className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                Connexion directe en 1 clic à votre projet Firebase « appcorrection » (sans ligne de
                commande ni fichier .env)
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Si vous souhaitez stocker vos données dans votre console Firebase personnelle :
                cliquez sur <strong>Ouvrir ma Console Firebase « appcorrection »</strong> ci-dessus,
                copiez le bloc <code>const firebaseConfig = &#123; ... &#125;</code> d’une
                application Web, collez-le ci-dessous puis validez. Compatible avec le plan gratuit
                Spark.
              </p>
              <textarea
                rows={5}
                value={firebaseSnippet}
                onChange={(e) => setFirebaseSnippet(e.target.value)}
                placeholder={'const firebaseConfig = {\n  apiKey: "AIza...",\n  authDomain: "appcorrection.firebaseapp.com",\n  projectId: "appcorrection",\n  appId: "1:..."\n};'}
                className="input-field font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowFirebaseBox(false)}
                  className="btn-secondary text-xs"
                >
                  Annuler
                </button>
                <button type="submit" className="btn-primary text-xs">
                  Connecter automatiquement « appcorrection »
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Profil et politique de conservation RGPD */}
        <form onSubmit={handleSaveProfile} className="card p-6 space-y-4">
          <div className="flex items-center gap-2 text-base font-bold">
            <ShieldCheck className="h-5 w-5 text-brand-700 dark:text-blue-400" />
            <span>Informations professionnelles & Conservation des données</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold mb-1">Nom</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Prénom</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Établissement</label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Discipline principale</label>
              <input
                type="text"
                value={defaultSubject}
                onChange={(e) => setDefaultSubject(e.target.value)}
                placeholder="Ex: Mathématiques, Physique-Chimie..."
                className="input-field"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">
                Durée de conservation des copies d’élèves (jours — conformité RGPD)
              </label>
              <input
                type="number"
                min={7}
                max={1825}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input-field max-w-xs"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Recommandé : 365 jours (une année scolaire). Vous pouvez supprimer ou archiver un
                examen à tout moment depuis « Mes examens ».
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              <Save className="h-4 w-4" /> Enregistrer mes paramètres
            </button>
          </div>
        </form>

        {/* Modification sécurisée du mot de passe avec ré-authentification */}
        <form onSubmit={handlePasswordChange} className="card p-6 space-y-4">
          <div className="flex items-center gap-2 text-base font-bold">
            <KeyRound className="h-5 w-5 text-amber-600" />
            <span>Modifier mon mot de passe (vérification d’identité requise)</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold mb-1">Mot de passe actuel *</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Nouveau mot de passe *</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 caractères, Maj, Min, Chiffre"
                className="input-field"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-secondary text-xs">
              Mettre à jour mon mot de passe
            </button>
          </div>
        </form>
      </div>
    </TeacherLayout>
  );
};
