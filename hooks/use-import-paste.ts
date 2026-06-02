'use client';

/**
 * Unified clipboard-paste importer.
 *
 * Intercepts paste events, sniffs the clipboard for a recognised design-tool
 * signature (currently Webflow's `@webflow/XscpData`; a Figma slot is reserved),
 * runs the shared import pipeline, and surfaces a summary toast. When no known
 * signature is present the event is left untouched so normal pasting works.
 *
 * The Ycode canvas is a same-origin iframe, so a paste fired while focus is
 * inside it never reaches the top `window`. We therefore attach the handler to
 * the top document AND every same-origin iframe document, re-attaching as
 * iframes (re)load.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { runImport } from '@/lib/import';
import { isWebflowClipboard, parseWebflowClipboard } from '@/lib/import/adapters/webflow';
import type { ImportDocument, ImportSummary } from '@/lib/import/types';

/** Build the clipboard text from whichever MIME type carries the payload. */
function readClipboardText(clipboardData: DataTransfer): string {
  return (
    clipboardData.getData('application/json') ||
    clipboardData.getData('text/plain') ||
    clipboardData.getData('text/html') ||
    ''
  );
}

/** Detect a known source and parse it into a neutral import document. */
function detectDocument(text: string): ImportDocument | null {
  if (isWebflowClipboard(text)) return parseWebflowClipboard(text);
  // Reserved: Figma (`__ycode_figma__`) dispatches here once its adapter lands.
  return null;
}

function summaryMessage(summary: ImportSummary): string {
  const parts = [
    `${summary.layers} layer${summary.layers === 1 ? '' : 's'}`,
    summary.styles > 0 ? `${summary.styles} style${summary.styles === 1 ? '' : 's'}` : '',
    summary.components > 0 ? `${summary.components} component${summary.components === 1 ? '' : 's'}` : '',
    summary.assets > 0 ? `${summary.assets} image${summary.assets === 1 ? '' : 's'}` : '',
    summary.fonts > 0 ? `${summary.fonts} font${summary.fonts === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Imported ${parts.join(', ')}`;
}

export function useImportPaste(): void {
  // Guards against a second paste landing while an import is still running.
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!event.clipboardData || isProcessingRef.current) return;

      // Don't hijack pastes into editable fields (inputs, text editor, etc.).
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const text = readClipboardText(event.clipboardData);
      if (!text) return;

      const importDocument = detectDocument(text);
      if (!importDocument) return; // Not a recognised payload — let the browser handle it.

      event.preventDefault();
      event.stopPropagation();

      isProcessingRef.current = true;
      const toastId = toast.loading(`Importing from ${importDocument.source}…`);

      void runImport(importDocument)
        .then((summary) => {
          toast.success(summaryMessage(summary), {
            id: toastId,
            description: summary.collections > 0
              ? `${summary.collections} collection${summary.collections === 1 ? '' : 's'} to re-link to your CMS.`
              : undefined,
          });
        })
        .catch((error) => {
          console.error('[useImportPaste] import failed:', error);
          toast.error(`Failed to import from ${importDocument.source}`, { id: toastId });
        })
        .finally(() => {
          isProcessingRef.current = false;
        });
    };

    // Track documents we've already wired up so we don't double-bind.
    const bound = new WeakSet<Document>();

    const bind = (doc: Document | null | undefined) => {
      if (!doc || bound.has(doc)) return;
      bound.add(doc);
      // Capture phase so we claim the event before canvas/editor handlers.
      doc.addEventListener('paste', handlePaste as EventListener, true);
    };

    // Top-level document.
    bind(document);

    // Same-origin iframe documents (the canvas). Re-scan periodically and on
    // load so we cover late-mounting and reloading iframes.
    const bindIframes = () => {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe) => {
        try {
          bind(iframe.contentDocument);
        } catch {
          // Cross-origin iframe — not accessible, skip.
        }
        iframe.addEventListener('load', () => {
          try {
            bind(iframe.contentDocument);
          } catch {
            /* cross-origin */
          }
        });
      });
    };

    bindIframes();
    const interval = window.setInterval(bindIframes, 1500);

    return () => {
      window.clearInterval(interval);
      // Detach from every document we may have bound. WeakSet isn't iterable,
      // so remove from the known set of documents (top + current iframes).
      document.removeEventListener('paste', handlePaste as EventListener, true);
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          iframe.contentDocument?.removeEventListener('paste', handlePaste as EventListener, true);
        } catch {
          /* cross-origin */
        }
      });
    };
  }, []);
}
