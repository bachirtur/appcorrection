import React from 'react';
import { Lock, Paperclip, Trash2, Check } from 'lucide-react';
import { StudentAnswerValue, StudentQuestionView } from '../types';
import { MathFormulaInput } from './MathFormulaInput';
import { CodeAnswerEditor } from './CodeAnswerEditor';

interface QuestionInputProps {
  question: StudentQuestionView;
  value: StudentAnswerValue | undefined;
  onChange: (next: StudentAnswerValue) => void;
  allowModifyBeforeSubmit: boolean;
  readOnly?: boolean;
}

export const QuestionInput: React.FC<QuestionInputProps> = ({
  question,
  value,
  onChange,
  allowModifyBeforeSubmit,
  readOnly = false,
}) => {
  const current: StudentAnswerValue = value || {};
  const isLocked = readOnly || (!allowModifyBeforeSubmit && Boolean(current.lockedByStudent));

  const update = (patch: Partial<StudentAnswerValue>) => {
    if (isLocked) return;
    onChange({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isLocked) return;
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(file.type)) {
      alert('Format non autorisé. Utilisez PNG, JPG, WEBP ou PDF.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert('La pièce jointe ne doit pas dépasser 4 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      update({
        attachment: {
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: typeof reader.result === 'string' ? reader.result : undefined,
          uploadedAt: new Date().toISOString(),
        },
      });
    };
    reader.readAsDataURL(file);
  };

  const wordCount = (current.text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div className="card p-4 sm:p-5 space-y-3.5 transition">
      {/* En-tête de la question */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            {question.exerciseTitle || 'Exercice'} — Question {question.number}
          </span>
          <p className="mt-1.5 text-sm font-medium text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
            {question.prompt}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {question.maxPoints} pt{question.maxPoints > 1 ? 's' : ''}
        </span>
      </div>

      {/* Corps du champ selon le type */}
      {question.type === 'short_text' && (
        <input
          type="text"
          value={current.text || ''}
          disabled={isLocked}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="Saisissez votre réponse courte..."
          className="input-field"
        />
      )}

      {question.type === 'long_text' && (
        <div className="space-y-1.5">
          <textarea
            rows={6}
            value={current.text || ''}
            disabled={isLocked}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Rédigez votre développement complet et structuré..."
            className="input-field leading-relaxed"
          />
          <div className="text-right text-[11px] text-slate-500">
            {wordCount} mot{wordCount > 1 ? 's' : ''} • {(current.text || '').length} caractères
          </div>
        </div>
      )}

      {question.type === 'mcq_single' && (
        <div className="space-y-2" role="radiogroup">
          {(question.options || []).map((opt) => {
            const checked = (current.selectedOptionIds || [])[0] === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition ${
                  checked
                    ? 'border-blue-600 bg-blue-50/70 font-medium text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                } ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                <input
                  type="radio"
                  name={`q_${question.id}`}
                  checked={checked}
                  disabled={isLocked}
                  onChange={() => update({ selectedOptionIds: [opt.id] })}
                  className="h-4 w-4 text-blue-600"
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.type === 'mcq_multiple' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Plusieurs réponses peuvent être exactes. Cochez toutes les propositions justes :
          </p>
          {(question.options || []).map((opt) => {
            const selected = current.selectedOptionIds || [];
            const checked = selected.includes(opt.id);
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition ${
                  checked
                    ? 'border-blue-600 bg-blue-50/70 font-medium text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                } ${isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isLocked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((id) => id !== opt.id)
                      : [...selected, opt.id];
                    update({ selectedOptionIds: next });
                  }}
                  className="h-4 w-4 rounded text-blue-600"
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.type === 'true_false' && (
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          {[
            { label: 'Vrai', val: true },
            { label: 'Faux', val: false },
          ].map((choice) => {
            const active = current.booleanValue === choice.val;
            return (
              <button
                key={choice.label}
                type="button"
                disabled={isLocked}
                onClick={() => update({ booleanValue: choice.val })}
                className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      )}

      {question.type === 'numeric' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <input
              type="text"
              inputMode="decimal"
              value={current.numericInput || ''}
              disabled={isLocked}
              onChange={(e) => update({ numericInput: e.target.value })}
              placeholder="Valeur numérique (ex: 9,81 ou -4.5)"
              className="input-field font-mono"
            />
          </div>
          {(question.requireUnit || question.unit) && (
            <div className="w-40">
              <input
                type="text"
                value={current.unitInput ?? (question.requireUnit ? '' : question.unit || '')}
                disabled={isLocked || (!question.requireUnit && Boolean(question.unit))}
                onChange={(e) => update({ unitInput: e.target.value })}
                placeholder={question.unit ? `Unité (ex: ${question.unit})` : 'Unité'}
                className="input-field font-mono"
              />
            </div>
          )}
        </div>
      )}

      {question.type === 'math_formula' && (
        <MathFormulaInput
          value={current.formula || ''}
          onChange={(formula) => update({ formula })}
          disabled={isLocked}
        />
      )}

      {question.type === 'code' && (
        <CodeAnswerEditor
          value={current.code ?? question.starterCode ?? ''}
          onChange={(code) => update({ code })}
          language={question.codeLanguage || 'python'}
          disabled={isLocked}
        />
      )}

      {question.type === 'table' && question.tableTemplate && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                {question.tableTemplate.headers.map((h, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {question.tableTemplate.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((tplCell, cIdx) => {
                    const editable =
                      question.tableTemplate?.editableMask?.[rIdx]?.[cIdx] ?? tplCell.trim() === '';
                    const val =
                      current.tableValues?.[rIdx]?.[cIdx] ?? (editable ? '' : tplCell);
                    return (
                      <td key={cIdx} className="p-1.5">
                        {editable ? (
                          <input
                            type="text"
                            value={val}
                            disabled={isLocked}
                            onChange={(e) => {
                              const grid = question.tableTemplate!.rows.map((r, ri) =>
                                r.map((c, ci) => current.tableValues?.[ri]?.[ci] ?? c)
                              );
                              grid[rIdx][cIdx] = e.target.value;
                              update({ tableValues: grid });
                            }}
                            placeholder="Compléter..."
                            className="w-full rounded border border-blue-200 bg-blue-50/40 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                          />
                        ) : (
                          <span className="block px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {tplCell}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {question.type === 'structured' && (
        <div className="space-y-3">
          {(question.structuredSections || [
            { id: 'hypothese', label: '1. Hypothèse / Données' },
            { id: 'developpement', label: '2. Raisonnement / Démonstration' },
            { id: 'conclusion', label: '3. Conclusion' },
          ]).map((sec) => (
            <div key={sec.id}>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {sec.label}
              </label>
              <textarea
                rows={3}
                disabled={isLocked}
                value={current.structuredValues?.[sec.id] || ''}
                onChange={(e) =>
                  update({
                    structuredValues: {
                      ...(current.structuredValues || {}),
                      [sec.id]: e.target.value,
                    },
                  })
                }
                placeholder={sec.placeholder || 'Rédigez cette partie...'}
                className="input-field text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {question.type === 'attachment' && (
        <div className="space-y-3">
          {!current.attachment ? (
            <label
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-blue-500 dark:border-slate-700 dark:bg-slate-900/50 ${
                isLocked ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <Paperclip className="h-6 w-6 text-slate-400 mb-1.5" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Joindre une image, un schéma ou un PDF (max 4 Mo)
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5">Formats : PNG, JPG, PDF</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                disabled={isLocked}
                onChange={handleAttachmentChange}
                className="hidden"
              />
            </label>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 truncate">
                <Paperclip className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="font-medium truncate">{current.attachment.fileName}</span>
                <span className="text-slate-400">
                  ({Math.round(current.attachment.size / 1024)} Ko)
                </span>
              </div>
              {!isLocked && (
                <button
                  type="button"
                  onClick={() => update({ attachment: undefined })}
                  className="text-red-600 hover:text-red-700 p-1"
                  title="Retirer le fichier"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          <input
            type="text"
            value={current.text || ''}
            disabled={isLocked}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Commentaire ou légende accompagnant votre pièce jointe (facultatif)"
            className="input-field text-xs"
          />
        </div>
      )}

      {/* Gestion du verrouillage unitaire lorsque allowModifyBeforeSubmit === false */}
      {!allowModifyBeforeSubmit && !readOnly && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
          {current.lockedByStudent ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <Lock className="h-3.5 w-3.5" /> Réponse validée et verrouillée (modification désactivée pour cet examen)
            </span>
          ) : (
            <>
              <span className="text-slate-500">
                Attention : l’enseignant a désactivé la modification une fois une réponse validée.
              </span>
              <button
                type="button"
                onClick={() => update({ lockedByStudent: true })}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 dark:bg-slate-700"
              >
                <Check className="h-3.5 w-3.5" /> Valider cette réponse
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
