import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { LegalModal } from '../components/LegalModals';
import { useAuth } from '../context/AuthContext';
import {
  confirmPasswordResetWithToken,
  requestPasswordReset,
} from '../services/auth';

type AuthTab = 'login' | 'register' | 'reset';

export const TeacherLogin: React.FC = () => {
  const { teacher, login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<AuthTab>(() =>
    searchParams.get('mode') === 'register' ? 'register' : 'login'
  );
  const [legalOpen, setLegalOpen] = useState(false);

  // Champs connexion & inscription
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [institution, setInstitution] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Réinitialisation du mot de passe
  const [resetToken, setResetToken] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (teacher) {
      navigate('/professeur/tableau-de-bord', { replace: true });
    }
  }, [teacher, navigate]);

  const passwordStrengthChecks = [
    { label: '8 caractères minimum', ok: password.length >= 8 },
    { label: 'Une majuscule et une minuscule', ok: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: 'Au moins un chiffre', ok: /[0-9]/.test(password) },
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfoMessage(null);
    try {
      await login(email, password);
      navigate('/professeur/tableau-de-bord');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfoMessage(null);
    try {
      await register({
        firstName,
        lastName,
        institution,
        email,
        password,
        confirmPassword,
        acceptedTerms,
      });
      navigate('/professeur/tableau-de-bord');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfoMessage(null);
    try {
      const res = await requestPasswordReset(email);
      setInfoMessage(res.message);
      if (res.resetTokenPreview) {
        setResetToken(res.resetTokenPreview);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la demande.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await confirmPasswordResetWithToken(resetToken, newResetPassword);
      setInfoMessage('Votre mot de passe a été mis à jour. Vous pouvez maintenant vous connecter.');
      setResetToken('');
      setNewResetPassword('');
      setTab('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Jeton invalide ou expiré.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-800 text-white shadow">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
              Espace Professeur Sécurisé
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Chaque enseignant dispose d’un compte isolé donnant accès exclusivement à ses examens,
              corrigés et copies.
            </p>
          </div>

          <div className="card overflow-hidden">
            {/* Onglets */}
            <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError(null);
                }}
                className={`py-3.5 transition ${
                  tab === 'login'
                    ? 'border-b-2 border-brand-700 bg-white text-brand-800 dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Connexion
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setError(null);
                }}
                className={`py-3.5 transition ${
                  tab === 'register'
                    ? 'border-b-2 border-brand-700 bg-white text-brand-800 dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Créer un compte
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('reset');
                  setError(null);
                }}
                className={`py-3.5 transition ${
                  tab === 'reset'
                    ? 'border-b-2 border-brand-700 bg-white text-brand-800 dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Mot de passe oublié
              </button>
            </div>

            <div className="p-6 sm:p-8">
              {error && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {infoMessage && (
                <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{infoMessage}</span>
                </div>
              )}

              {tab === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Adresse e-mail professionnelle
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="prenom.nom@etablissement.edu"
                        className="input-field pl-9"
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Mot de passe
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input-field pl-9"
                        autoComplete="current-password"
                      />
                    </div>
                  </div>

                  <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                    {submitting ? 'Vérification sécurisée...' : 'Se connecter à mon espace'}
                  </button>
                </form>
              )}

              {tab === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Nom *
                      </label>
                      <input
                        type="text"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Dupont"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Prénom *
                      </label>
                      <input
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Marie"
                        className="input-field"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Adresse e-mail professionnelle *
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="marie.dupont@ac-education.fr"
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Établissement scolaire (facultatif)
                    </label>
                    <input
                      type="text"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      placeholder="Lycée Pilote / Collège / Université..."
                      className="input-field"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Mot de passe *
                      </label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min. 8 caractères"
                        className="input-field"
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Confirmation du mot de passe *
                      </label>
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Répétez le mot de passe"
                        className="input-field"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  {/* Critères de sécurité du mot de passe */}
                  <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1 dark:bg-slate-800/60">
                    {passwordStrengthChecks.map((chk) => (
                      <div
                        key={chk.label}
                        className={`flex items-center gap-1.5 ${
                          chk.ok
                            ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                            : 'text-slate-500'
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{chk.label}</span>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-blue-600"
                    />
                    <span>
                      J’accepte les{' '}
                      <button
                        type="button"
                        onClick={() => setLegalOpen(true)}
                        className="font-semibold text-blue-700 underline dark:text-blue-400"
                      >
                        conditions d’utilisation et la politique de confidentialité
                      </button>{' '}
                      relatives à la protection des données personnelles des élèves.
                    </span>
                  </label>

                  <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                    <UserPlus className="h-4 w-4" />
                    <span>{submitting ? 'Création sécurisée...' : 'Créer mon compte professeur'}</span>
                  </button>
                </form>
              )}

              {tab === 'reset' && (
                <div className="space-y-5">
                  <form onSubmit={handleResetRequest} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Adresse e-mail du compte professeur
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="prenom.nom@etablissement.edu"
                        className="input-field"
                      />
                    </div>
                    <button type="submit" disabled={submitting} className="btn-primary w-full">
                      <KeyRound className="h-4 w-4" />
                      <span>Demander la réinitialisation du mot de passe</span>
                    </button>
                  </form>

                  {resetToken && (
                    <form
                      onSubmit={handleResetConfirm}
                      className="border-t border-slate-200 pt-4 space-y-3 dark:border-slate-800"
                    >
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Définissez votre nouveau mot de passe avec le jeton de vérification généré :
                      </p>
                      <input
                        type="password"
                        required
                        value={newResetPassword}
                        onChange={(e) => setNewResetPassword(e.target.value)}
                        placeholder="Nouveau mot de passe sécurisé"
                        className="input-field"
                      />
                      <button type="submit" disabled={submitting} className="btn-primary w-full">
                        Valider le nouveau mot de passe
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <LegalModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  );
};
