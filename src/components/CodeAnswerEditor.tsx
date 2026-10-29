import React, { useMemo, useRef } from 'react';
import { CodeLanguage } from '../types';

interface CodeAnswerEditorProps {
  value: string;
  onChange: (next: string) => void;
  language?: CodeLanguage;
  disabled?: boolean;
}

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  python: 'Python 3',
  javascript: 'JavaScript (ES2022)',
  sql: 'SQL',
  c: 'Langage C',
  html: 'HTML / CSS',
  pseudocode: 'Algorithme / Pseudo-code',
};

function highlightSyntaxSafe(code: string, lang: CodeLanguage): string {
  const escaped = (code || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const keywordsByLang: Record<CodeLanguage, RegExp> = {
    python:
      /\b(def|return|if|elif|else|for|while|in|range|import|from|class|True|False|None|and|or|not|try|except|len|print)\b/g,
    javascript:
      /\b(function|const|let|var|return|if|else|for|while|of|in|class|true|false|null|undefined|async|await|console)\b/g,
    sql: /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|GROUP|BY|ORDER|INSERT|INTO|VALUES|UPDATE|SET|DELETE|COUNT|AVG|SUM|AND|OR|AS|DISTINCT)\b/gi,
    c: /\b(int|float|double|char|void|return|if|else|for|while|struct|include|printf|scanf)\b/g,
    html: /\b(div|span|section|header|main|footer|table|tr|td|th|form|input|button|style|class)\b/g,
    pseudocode:
      /\b(Algorithme|Variables|Début|Fin|Si|Alors|Sinon|FinSi|Pour|Allant|De|À|Faire|FinPour|TantQue|FinTantQue|Retourner|Afficher)\b/gi,
  };

  return escaped
    .replace(/(#.*$|\/\/.*$|--.*$)/gm, '<span class="text-emerald-400 italic">$1</span>')
    .replace(/("[^"\n]*"|'[^'\n]*')/g, '<span class="text-amber-300">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-purple-300">$1</span>')
    .replace(keywordsByLang[lang], '<span class="text-sky-400 font-semibold">$1</span>');
}

export const CodeAnswerEditor: React.FC<CodeAnswerEditorProps> = ({
  value,
  onChange,
  language = 'python',
  disabled = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const linesCount = Math.max(8, (value || '').split('\n').length);

  const highlighted = useMemo(
    () => highlightSyntaxSafe(value || '', language) + '\n',
    [value, language]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    // Indentation Tab = 4 espaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const next = value.substring(0, start) + '    ' + value.substring(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    } else if (e.key === 'Enter') {
      const currentLineStart = value.lastIndexOf('\n', start - 1) + 1;
      const currentLine = value.slice(currentLineStart, start);
      const indentMatch = currentLine.match(/^\s*/);
      const baseIndent = indentMatch ? indentMatch[0] : '';
      const extraIndent = /[:{]\s*$/.test(currentLine) ? '    ' : '';
      e.preventDefault();
      const insert = '\n' + baseIndent + extraIndent;
      const next = value.substring(0, start) + insert + value.substring(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + insert.length;
      });
    }
  };

  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 shadow-inner">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3.5 py-2 text-xs">
        <span className="font-mono font-semibold text-blue-300">
          {LANGUAGE_LABELS[language]}
        </span>
        <span className="text-[11px] text-slate-400">
          Touche Tab : indentation 4 espaces
        </span>
      </div>

      <div className="relative flex font-mono text-xs sm:text-sm leading-6">
        {/* Numéros de lignes */}
        <div
          aria-hidden="true"
          className="select-none border-r border-slate-800 bg-slate-900/80 px-3 py-3 text-right text-slate-500"
        >
          {Array.from({ length: linesCount }).map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>

        {/* Couche coloration + couche saisie synchronisées */}
        <div className="relative flex-1 min-h-[208px]">
          <pre
            ref={preRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre p-3 font-mono text-xs sm:text-sm leading-6 text-slate-100"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            rows={Math.max(8, linesCount)}
            className="relative z-10 block w-full resize-y bg-transparent p-3 font-mono text-xs sm:text-sm leading-6 text-transparent caret-white focus:outline-none focus:ring-0 selection:bg-blue-500/40"
            placeholder="# Écrivez votre programme ici..."
          />
        </div>
      </div>
    </div>
  );
};
