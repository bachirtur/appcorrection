import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MailWarning,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { FIREBASE_CONFIG, getActiveBackendMode } from '../services/firebase';

export const TeacherLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { teacher, verificationCodePreview, verifyEmail, logout } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [verifInput, setVerifInput] = useState('');
  const [verifMsg, setVerifMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const backendMode = getActiveBackendMode();

  const navItems = [
    {
      label: 'Tableau de bord',
      to: '/professeur/tableau-de-bord',
      icon: LayoutDashboard,
    },
    {
      label: 'Créer un examen',
      to: '/professeur/examens/nouveau',
      icon: FilePlus2,
    },
    {
      label: 'Mes examens',
      to: '/professeur/examens',
      icon: FolderOpen,
      end: true,
    },
    {
      label: 'Copies des élèves',
      to: '/professeur/copies',
      icon: ClipboardList,
    },
    {
      label: 'Notes et statistiques',
      to: '/professeur/statistiques',
      icon: BarChart3,
    },
    {
      label: 'Rapports PDF',
      to: '/professeur/rapports',
      icon: FileSpreadsheet,
    },
    {
      label: 'Paramètres du compte',
      to: '/professeur/parametres',
      icon: Settings,
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setVerifMsg(null);
    try {
      await verifyEmail(verifInput || verificationCodePreview);
      setVerifMsg('Adresse e-mail professionnelle vérifiée avec succès.');
    } catch (err) {
      setVerifMsg(err instanceof Error ? err.message : 'Échec de vérification.');
    } finally {
      setVerifying(false);
    }
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between bg-brand-950 text-slate-100">
      <div>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">EduExam</div>
              <div className="text-[11px] text-blue-300">Espace Professeur</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {teacher && (
          <div className="border-b border-slate-800/80 px-5 py-3.5">
            <p className="truncate text-sm font-semibold text-white">
              {teacher.firstName} {teacher.lastName}
            </p>
            <p className="truncate text-xs text-slate-400">{teacher.email}</p>
            <div className="mt-2 flex items-center gap-1.5">
              {teacher.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/90 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-800">
                  <CheckCircle2 className="h-3 w-3" /> E-mail vérifié
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/90 px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-800">
                  <MailWarning className="h-3 w-3" /> À vérifier
                </span>
              )}
            </div>
          </div>
        )}

        <nav aria-label="Menu professeur" className="mt-3 space-y-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-800 p-3 space-y-2">
        <div className="rounded-lg bg-slate-900/90 px-3 py-2 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-200">Backend actif : </span>
          {backendMode === 'firebase'
            ? `Firebase (${FIREBASE_CONFIG.projectId})`
            : `Serveur sécurisé (prêt pour ${FIREBASE_CONFIG.projectId})`}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-950/50 hover:text-red-200"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Barre latérale fixe ordinateur */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-30 lg:flex lg:w-64 lg:flex-col">
        {renderSidebarContent()}
      </aside>

      {/* Tiroir mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-50 flex w-72 max-w-[85vw] flex-col">
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Contenu principal */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 lg:hidden dark:border-slate-700 dark:text-slate-300"
              aria-label="Ouvrir le menu latéral"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Plateforme d’évaluation sécurisée — Espace enseignant
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label={darkMode ? 'Mode clair' : 'Mode sombre'}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Bandeau de validation d'e-mail (Section 4.1 & 13) */}
        {teacher && !teacher.emailVerified && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6">
            <form
              onSubmit={handleVerifyEmail}
              className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm"
            >
              <div className="flex items-center gap-2">
                <MailWarning className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <strong>Vérification de votre adresse e-mail requise</strong> pour activer la
                  réception des notifications de copies par e-mail.
                  {verificationCodePreview && (
                    <span className="ml-1.5 rounded bg-amber-200/70 px-1.5 py-0.5 font-mono font-bold dark:bg-amber-900">
                      Code : {verificationCodePreview}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {backendMode === 'api' && (
                  <input
                    type="text"
                    value={verifInput}
                    onChange={(e) => setVerifInput(e.target.value)}
                    placeholder={verificationCodePreview || 'Code reçu'}
                    className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-white"
                  />
                )}
                <button
                  type="submit"
                  disabled={verifying}
                  className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800"
                >
                  {verifying ? 'Validation...' : 'Valider mon adresse e-mail'}
                </button>
              </div>
            </form>
            {verifMsg && <p className="mt-1 text-xs font-medium">{verifMsg}</p>}
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
};
