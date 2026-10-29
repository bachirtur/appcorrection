import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  pdfBytes: Uint8Array | null;
  fileName?: string;
  allowDownload?: boolean;
  onDownloadClick?: () => void;
  title?: string;
  heightClass?: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfBytes,
  fileName = 'Document.pdf',
  allowDownload = false,
  onDownloadClick,
  title = 'Lecteur de document PDF',
  heightClass = 'h-[620px]',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Recherche plein texte dans le PDF
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [matchedPages, setMatchedPages] = useState<{ page: number; snippet: string }[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState<number>(0);

  // Chargement du document binaire en mémoire (copie défensive car pdf.js détache parfois l'ArrayBuffer)
  useEffect(() => {
    let cancelled = false;
    if (!pdfBytes || pdfBytes.byteLength === 0) {
      setPdfDoc(null);
      setNumPages(0);
      setPageTexts([]);
      return;
    }

    setLoading(true);
    setError(null);

    const cloned = new Uint8Array(pdfBytes.byteLength);
    cloned.set(pdfBytes);

    const loadingTask = pdfjsLib.getDocument({ data: cloned });
    loadingTask.promise
      .then(async (loadedDoc) => {
        if (cancelled) return;
        setPdfDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setPageNumber(1);

        // Extraction du texte des pages pour la recherche rapide
        const extracted: string[] = [];
        for (let p = 1; p <= loadedDoc.numPages; p++) {
          try {
            const pg = await loadedDoc.getPage(p);
            const content = await pg.getTextContent();
            const text = content.items
              .map((item: any) => ('str' in item ? item.str : ''))
              .join(' ');
            extracted.push(text);
          } catch {
            extracted.push('');
          }
        }
        if (!cancelled) setPageTexts(extracted);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Impossible d’afficher le PDF : ${err.message}`
              : 'Document PDF illisible.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfBytes]);

  // Rendu de la page courante sur le canvas
  const renderCurrentPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    } catch {
      // ignore cancelled render on rapid zoom/page switch
    }
  }, [pdfDoc, pageNumber, scale]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

  // Recherche dans le texte extrait
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || pageTexts.length === 0) {
      setMatchedPages([]);
      setActiveMatchIdx(0);
      return;
    }
    const results: { page: number; snippet: string }[] = [];
    pageTexts.forEach((txt, idx) => {
      const pos = txt.toLowerCase().indexOf(q);
      if (pos !== -1) {
        const start = Math.max(0, pos - 28);
        const end = Math.min(txt.length, pos + q.length + 38);
        results.push({
          page: idx + 1,
          snippet: `${start > 0 ? '…' : ''}${txt.slice(start, end)}${end < txt.length ? '…' : ''}`,
        });
      }
    });
    setMatchedPages(results);
    setActiveMatchIdx(0);
    if (results.length > 0) {
      setPageNumber(results[0].page);
    }
  }, [searchQuery, pageTexts]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // navigateur restreignant le plein écran
    }
  };

  const handleLocalDownload = () => {
    if (onDownloadClick) {
      onDownloadClick();
      return;
    }
    if (!pdfBytes) return;
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900 ${
        isFullscreen ? 'fixed inset-0 z-50 h-screen rounded-none' : heightClass
      }`}
    >
      {/* Barre d'outils PDF */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate font-semibold text-slate-700 dark:text-slate-200 max-w-[180px] sm:max-w-[240px]">
            {title}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Navigation pages */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              aria-label="Page précédente"
              className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-medium text-slate-700 dark:text-slate-200">
              {numPages > 0 ? `${pageNumber} / ${numPages}` : '0 / 0'}
            </span>
            <button
              type="button"
              disabled={pageNumber >= numPages}
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              aria-label="Page suivante"
              className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Contrôles de zoom */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))))}
              aria-label="Zoom arrière"
              className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[11px]">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.6, Number((s + 0.15).toFixed(2))))}
              aria-label="Zoom avant"
              className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setScale(1.15)}
              title="Réinitialiser le zoom"
              className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>

          {/* Recherche dans le document */}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            title="Rechercher dans le PDF"
            className={`rounded-lg border p-1.5 transition ${
              searchOpen
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* Plein écran */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Téléchargement autorisé */}
          {allowDownload && pdfBytes && (
            <button
              type="button"
              onClick={handleLocalDownload}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-2.5 py-1.5 font-semibold text-white hover:bg-brand-800"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Télécharger</span>
            </button>
          )}
        </div>
      </div>

      {/* Barre de recherche dépliable */}
      {searchOpen && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un mot ou une expression dans le sujet..."
              className="w-full max-w-sm rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          {searchQuery.trim() && (
            <div className="flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-300">
                {matchedPages.length > 0
                  ? `${matchedPages.length} page(s) correspondante(s)`
                  : 'Aucune occurrence'}
              </span>
              {matchedPages.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = (activeMatchIdx + 1) % matchedPages.length;
                    setActiveMatchIdx(nextIdx);
                    setPageNumber(matchedPages[nextIdx].page);
                  }}
                  className="rounded bg-blue-600 px-2 py-0.5 text-white"
                >
                  Occurrence suivante (p.{matchedPages[(activeMatchIdx + 1) % matchedPages.length].page})
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Zone d'affichage Canvas */}
      <div className="flex-1 overflow-auto p-4 flex justify-center items-start bg-slate-200/70 dark:bg-slate-950/70">
        {loading ? (
          <div className="my-auto text-center text-sm text-slate-500">
            Chargement sécurisé du document PDF...
          </div>
        ) : error ? (
          <div className="my-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : !pdfBytes ? (
          <div className="my-auto text-center text-sm text-slate-500 dark:text-slate-400">
            Aucun document PDF sélectionné.
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="rounded bg-white shadow-lg max-w-full"
          />
        )}
      </div>
    </div>
  );
};
