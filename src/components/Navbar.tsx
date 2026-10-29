import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GraduationCap, Moon, ShieldCheck, Sun, UserCheck } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const { darkMode, toggleDarkMode } = useTheme();
  const { teacher } = useAuth();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex items-center gap-3 text-slate-900 transition hover:opacity-90 dark:text-white"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-800 text-white shadow-sm">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div>
            <span className="block text-base font-bold tracking-tight">EduExam</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Plateforme d’évaluation intelligente
            </span>
          </div>
        </Link>

        <nav aria-label="Navigation principale" className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/eleve"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith('/eleve')
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Espace élève
          </Link>

          <Link
            to={teacher ? '/professeur/tableau-de-bord' : '/professeur/connexion'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              location.pathname.startsWith('/professeur')
                ? 'bg-brand-800 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {teacher ? <UserCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            <span>{teacher ? 'Mon espace professeur' : 'Espace professeur'}</span>
          </Link>

          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={darkMode ? 'Passer au mode clair' : 'Passer au mode sombre'}
            className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </nav>
      </div>
    </header>
  );
};
