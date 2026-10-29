import React, { useMemo } from 'react';
import katex from 'katex';

interface MathFormulaInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const QUICK_SYMBOLS = [
  { label: 'a/b', insert: '\\frac{a}{b}' },
  { label: '√x', insert: '\\sqrt{x}' },
  { label: 'x²', insert: 'x^{2}' },
  { label: 'xⁿ', insert: 'x^{n}' },
  { label: 'π', insert: '\\pi' },
  { label: 'Δ', insert: '\\Delta' },
  { label: '≤', insert: '\\le ' },
  { label: '≥', insert: '\\ge ' },
  { label: '≠', insert: '\\neq ' },
  { label: '∑', insert: '\\sum_{i=1}^{n}' },
  { label: '∫', insert: '\\int_{a}^{b}' },
  { label: '→', insert: '\\rightarrow ' },
  { label: '∞', insert: '\\infty' },
];

export const MathFormulaInput: React.FC<MathFormulaInputProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const renderedHtml = useMemo(() => {
    if (!value?.trim()) return '';
    try {
      return katex.renderToString(value, {
        throwOnError: false,
        displayMode: true,
        trust: false,
      });
    } catch {
      return '';
    }
  }, [value]);

  const appendSnippet = (snippet: string) => {
    if (disabled) return;
    onChange(`${value || ''}${value ? ' ' : ''}${snippet}`);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {QUICK_SYMBOLS.map((sym) => (
          <button
            key={sym.label}
            type="button"
            disabled={disabled}
            onClick={() => appendSnippet(sym.insert)}
            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {sym.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Saisissez votre expression (ex: (-b + \sqrt{\Delta}) / (2a) ou 3x^2 + 2x - 1)"
        className="input-field font-mono text-sm"
      />

      {value?.trim() && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Aperçu mathématique en direct
          </div>
          <div
            className="overflow-x-auto text-slate-900 dark:text-slate-100"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
      )}
    </div>
  );
};
