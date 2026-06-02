/**
 * Insert imported layers onto the canvas (page draft) or into the component
 * currently being edited, then select the first one.
 */

import type { Layer } from '@/types';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { findLayerById, canHaveChildren } from '@/lib/layer-utils';

/**
 * Insert the given top-level layers at the best available target and select
 * the first inserted layer. Returns the number of layers inserted.
 */
export function insertImportedLayers(layers: Layer[]): number {
  if (layers.length === 0) return 0;

  const editor = useEditorStore.getState();
  const { selectedLayerId, currentPageId, editingComponentId, editingComponentVariantId } = editor;

  if (editingComponentId) {
    return insertIntoComponent(editingComponentId, editingComponentVariantId, layers);
  }

  if (!currentPageId) return 0;
  return insertIntoPage(currentPageId, selectedLayerId, layers);
}

function insertIntoPage(pageId: string, selectedLayerId: string | null, layers: Layer[]): number {
  const pages = usePagesStore.getState();
  const draft = pages.draftsByPageId[pageId];

  const selected = selectedLayerId && draft
    ? findLayerById(draft.layers, selectedLayerId)
    : null;

  let firstInsertedId: string | null = null;
  let inserted = 0;

  for (const layer of layers) {
    let result: Layer | null = null;

    if (selected && canHaveChildren(selected)) {
      result = pages.pasteInside(pageId, selected.id, layer);
    } else if (selected) {
      result = pages.pasteAfter(pageId, selected.id, layer);
    } else {
      const roots = usePagesStore.getState().draftsByPageId[pageId]?.layers ?? [];
      const lastRoot = roots[roots.length - 1];
      if (lastRoot) {
        result = pages.pasteAfter(pageId, lastRoot.id, layer);
      } else {
        pages.addLayerWithId(pageId, null, layer);
        result = layer;
      }
    }

    if (result) {
      inserted += 1;
      if (!firstInsertedId) firstInsertedId = result.id;
    }
  }

  if (firstInsertedId) useEditorStore.getState().setSelectedLayerId(firstInsertedId);
  return inserted;
}

function insertIntoComponent(
  componentId: string,
  variantId: string | null,
  layers: Layer[],
): number {
  const components = useComponentsStore.getState();
  const current = components.getComponentDraftLayers(componentId, variantId);

  // Append at the component root so the new content is always visible.
  const resolvedVariantId = variantId ?? components.components.find((c) => c.id === componentId)?.variants?.[0]?.id ?? '';
  const next = [...current, ...layers];
  components.updateComponentDraft(componentId, resolvedVariantId, next);

  if (layers[0]) useEditorStore.getState().setSelectedLayerId(layers[0].id);
  return layers.length;
}
