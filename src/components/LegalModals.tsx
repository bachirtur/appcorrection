import React from 'react';
import { Shield, X } from 'lucide-react';

interface LegalModalProps {
  open: boolean;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    >
      <div className="card max-h-[85vh] w-full max-w-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-brand-700 dark:text-blue-400" />
            <h2 id="legal-modal-title" className="text-base font-bold">
              Conditions d’utilisation & Politique de confidentialité (RGPD / Données scolaires)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <section>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
              1. Finalité exclusivement pédagogique
            </h3>
            <p>
              EduExam a pour unique objet l’organisation, la passation, la correction et la restitution
              d’évaluations scolaires sous la responsabilité pédagogique de l’enseignant propriétaire du
              compte. Aucune donnée personnelle d’élève ou d’enseignant n’est exploitée à des fins
              commerciales ou publicitaires.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
              2. Minimisation des données et protection des mineurs
            </h3>
            <p>
              Seules les données strictement nécessaires à l’identification de la copie sont collectées
              auprès de l’élève : nom, prénom, classe/groupe, réponses saisies, horodatage de session
              et, uniquement si l’enseignant l’exige, adresse e-mail scolaire.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
              3. Suivi proportionné de l’intégrité de l’épreuve
            </h3>
            <p>
              Lorsqu’il est activé, le suivi technique enregistre uniquement les événements de la fenêtre
              d’examen (perte de focus, changement d’onglet, sortie du plein écran). EduExam ne capture
              ni webcam, ni microphone, ni fichiers personnels de l’appareil. Ces indicateurs sont
              soumis à l’appréciation humaine du professeur et ne constituent pas une preuve automatique
              de fraude.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
              4. Isolation, confidentialité et durée de conservation
            </h3>
            <p>
              Chaque compte professeur est strictement isolé. Les sujets et corrigés PDF sont conservés
              dans un stockage privé non indexé. L’enseignant définit dans ses paramètres la durée de
              conservation des copies (par défaut 365 jours, soit une année scolaire) et peut supprimer
              ou archiver ses examens à tout moment.
            </p>
          </section>
        </div>

        <div className="border-t border-slate-200 px-6 py-3.5 flex justify-end dark:border-slate-800">
          <button type="button" onClick={onClose} className="btn-primary">
            J’ai pris connaissance de ces engagements
          </button>
        </div>
      </div>
    </div>
  );
};
