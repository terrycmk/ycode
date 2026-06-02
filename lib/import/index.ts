/**
 * Shared import pipeline entry point.
 *
 * Source adapters (Webflow, Figma) produce an `ImportDocument`; this runs the
 * common steps — install fonts, convert IR → layers, recover components, insert
 * onto the canvas — and returns a summary for the UI.
 */

import { ImportMaterializer } from '@/lib/import/materializer';
import { ImportConverter } from '@/lib/import/convert';
import { componentizeLayers } from '@/lib/import/componentize';
import { insertImportedLayers } from '@/lib/import/insert';
import { useFontsStore } from '@/stores/useFontsStore';
import type { ImportDocument, ImportSummary } from '@/lib/import/types';

function countLayers(layers: { children?: unknown[] }[]): number {
  let total = 0;
  const walk = (list: { children?: unknown[] }[]) => {
    for (const layer of list) {
      total += 1;
      if (Array.isArray(layer.children)) walk(layer.children as { children?: unknown[] }[]);
    }
  };
  walk(layers);
  return total;
}

function countCollections(layers: Array<{ variables?: { collection?: unknown }; children?: unknown[] }>): number {
  let total = 0;
  const walk = (list: Array<{ variables?: { collection?: unknown }; children?: unknown[] }>) => {
    for (const layer of list) {
      if (layer.variables?.collection) total += 1;
      if (Array.isArray(layer.children)) walk(layer.children as typeof list);
    }
  };
  walk(layers);
  return total;
}

export async function runImport(document: ImportDocument): Promise<ImportSummary> {
  const mat = new ImportMaterializer(document.source);

  // Install referenced fonts up front (best-effort; needs the catalog loaded).
  if (document.fonts && document.fonts.length > 0) {
    await useFontsStore.getState().loadGoogleFontsCatalog();
    await Promise.all(document.fonts.map((f) => mat.installFont(f.family)));
  }

  const converter = new ImportConverter(mat);
  let layers = await converter.convertNodes(document.roots);
  layers = await componentizeLayers(layers, mat);

  const collections = countCollections(layers);
  const layerCount = countLayers(layers);

  insertImportedLayers(layers);

  return {
    layers: layerCount,
    styles: mat.counts.styles,
    components: mat.counts.components,
    assets: mat.counts.assets,
    fonts: mat.counts.fonts,
    collections,
  };
}

export type { ImportDocument, ImportSummary } from '@/lib/import/types';
