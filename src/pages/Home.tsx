import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  GraduationCap,
  Lock,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { LegalModal } from '../components/LegalModals';

export const Home: React.FC = () => {
  const [legalOpen, setLegalOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <main className="flex-1">
        {/* Section Héro avec séparation claire des deux espaces */}
        <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-slate-50 to-blue-50/40 py-12 sm:py-16 lg:py-20 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Évaluation scolaire multi-matières & multi-niveaux sécurisée
              </span>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl dark:text-white">
                EduExam — Plateforme d’évaluation intelligente
              </h1>
              <p className="mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
                Un environnement numérique rigoureux, clair et confidentiel permettant aux enseignants
                de créer des évaluations sur mesure à partir de leurs sujets PDF, et aux élèves de
                composer sereinement en ligne.
              </p>
            </div>

            {/* Deux portails strictement distincts (Section 3) */}
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2 max-w-5xl mx-auto">
              {/* Carte Espace Élève */}
              <div className="card p-6 sm:p-8 flex flex-col justify-between border-2 border-blue-100 hover:border-blue-500/70 transition dark:border-slate-800 dark:hover:border-blue-600">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                      Accès par code d’examen
                    </span>
                  </div>

                  <h2 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                    Espace Élève — Participer à une évaluation
                  </h2>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Accédez directement à votre épreuve à l’aide de l’identifiant d’examen et du mot de
                    passe communiqués par votre enseignant. Aucune inscription préalable n’est requise.
                  </p>

                  <ul className="mt-5 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                      <span>Consultation et téléchargement autorisé du sujet PDF</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                      <span>Interface double colonne : sujet à gauche, réponses à droite</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                      <span>Sauvegarde automatique régulière et accusé de réception PDF</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-7 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <Link to="/eleve" className="btn-primary w-full py-3 text-base">
                    <span>Accéder à une évaluation</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* Carte Espace Professeur */}
              <div className="card p-6 sm:p-8 flex flex-col justify-between border-2 border-slate-200 hover:border-brand-700/70 transition dark:border-slate-800 dark:hover:border-slate-600">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-900 text-white shadow-sm dark:bg-slate-800">
                      <GraduationCap className="h-6 w-6" />
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Compte personnel isolé
                    </span>
                  </div>

                  <h2 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                    Espace Professeur — Conception & Correction
                  </h2>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Créez votre espace privé, importez vos sujets et corrigés PDF confidentiels,
                    configurez votre barème et gérez les copies, les notes et les rapports de vos classes.
                  </p>

                  <ul className="mt-5 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>Stockage privé des sujets et confidentialité stricte des corrigés</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>Trois modes de barème : Automatique (A), Assisté (B), Manuel (C)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>Rapports PDF détaillés, export CSV, audit et notifications e-mail</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-7 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
                  <Link
                    to="/professeur/connexion"
                    className="btn-primary flex-1 py-3 bg-brand-900 hover:bg-brand-950"
                  >
                    <span>Connexion professeur</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/professeur/connexion?mode=register"
                    className="btn-secondary py-3"
                  >
                    Créer un compte
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Piliers fonctionnels et pédagogiques */}
        <section className="py-14 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Conçue pour toutes les disciplines et tous les niveaux scolaires
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Du primaire à l’enseignement supérieur : mathématiques, sciences, français, langues,
              informatique, technologie, histoire-géographie et formation professionnelle.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: FileText,
                title: 'Sujets & Corrigés PDF privés',
                desc: 'Lecteur PDF intégré avec zoom, recherche et plein écran. Le corrigé reste inaccessible aux élèves.',
              },
              {
                icon: Sliders,
                title: '10 types de réponses riches',
                desc: 'QCM, numérique avec unité, formules KaTeX, éditeur Python/SQL/JS, tableaux, rédactions et schémas.',
              },
              {
                icon: Clock,
                title: 'Chronomètre & Sauvegarde serveur',
                desc: 'Compte à rebours contrôlé côté serveur, sauvegarde périodique et reprise après coupure réseau.',
              },
              {
                icon: Award,
                title: 'Notation /20, Audit & PDF',
                desc: 'Normalisation sur 20, mentions officielles, journal d’audit des notes et double rapport PDF A / PDF B.',
              },
            ].map((feat) => {
              const Icon = feat.icon;
              return (
                <div key={feat.title} className="card p-5 space-y-2.5">
                  <div className="inline-flex rounded-lg bg-blue-50 p-2.5 text-brand-700 dark:bg-blue-950/60 dark:text-blue-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{feat.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-brand-700 dark:text-blue-400" />
            <span>
              EduExam — Architecture sécurisée sans secret exposé côté client • Isolation stricte des
              comptes enseignants
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setLegalOpen(true)}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              Conditions d’utilisation & Confidentialité (RGPD)
            </button>
            <span className="inline-flex items-center gap-1">
              <FileCheck2 className="h-3.5 w-3.5" /> Projet Firebase : appcorrection
            </span>
          </div>
        </div>
      </footer>

      <LegalModal open={legalOpen} onClose={() => setLegalOpen(false)} />
    </div>
  );
};
