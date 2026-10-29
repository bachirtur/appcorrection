import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

interface ReauthModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}

export const ReauthModal: React.FC<ReauthModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirmer l’opération',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Veuillez saisir votre mot de passe actuel.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vérification refusée.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    >
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-amber-100 p-2 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              <KeyRound className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{description}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">
              Mot de passe professeur (vérification d’identité)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Votre mot de passe actuel"
              autoFocus
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={danger ? 'btn-danger' : 'btn-primary'}
            >
              {submitting ? 'Vérification...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
