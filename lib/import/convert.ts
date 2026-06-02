/**
 * IR → Ycode `Layer[]` conversion.
 *
 * Walks the neutral `ImportNode` tree and produces real Ycode layers, creating
 * (and linking) shared `LayerStyle`s and re-hosting assets through the
 * materializer along the way.
 */

import type { Layer, LinkSettings } from '@/types';
import { generateId } from '@/lib/utils';
import { buildDesign } from '@/lib/import/design';
import type { ImportMaterializer } from '@/lib/import/materializer';
import type { ImportNode } from '@/lib/import/types';

/** Semantic tags that should be preserved via `settings.tag` on a div layer. */
const SEMANTIC_TAGS = new Set([
  'section', 'nav', 'header', 'footer', 'main', 'aside', 'article',
  'ul', 'ol', 'li', 'figure', 'figcaption', 'blockquote',
]);

interface ResolvedStyling {
  classes: string;
  design: Layer['design'];
  styleId?: string;
  styleOverrides?: Layer['styleOverrides'];
}

/** Build a Tiptap rich-text doc from plain text (newlines become hard breaks). */
function buildTextDoc(text: string): object {
  const parts = text.split('\n');
  const content: Array<Record<string, unknown>> = [];
  parts.forEach((part, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (part) content.push({ type: 'text', text: part });
  });
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function makeRichTextVariable(text: string) {
  return { type: 'dynamic_rich_text' as const, data: { content: buildTextDoc(text) } };
}

export class ImportConverter {
  constructor(private readonly mat: ImportMaterializer) {}

  /** Convert a list of root nodes into Ycode layers. */
  async convertNodes(nodes: ImportNode[]): Promise<Layer[]> {
    const layers: Layer[] = [];
    for (const node of nodes) {
      const layer = await this.convertNode(node);
      if (layer) layers.push(layer);
    }
    return layers;
  }

  private async convertNode(node: ImportNode): Promise<Layer | null> {
    switch (node.kind) {
      case 'icon':
        return this.convertIcon(node);
      case 'image':
        return this.convertImage(node);
      case 'text':
      case 'heading':
        return this.convertText(node);
      case 'collection':
        return this.convertCollection(node);
      case 'link':
        return this.convertBox(node, true);
      case 'box':
      default:
        return this.convertBox(node, false);
    }
  }

  /** Resolve a node's reusable styles + extra classes into a styled layer base. */
  private async resolveStyling(node: ImportNode): Promise<ResolvedStyling> {
    const refs = node.styles ?? [];
    const extra = node.classes ?? [];

    const base = refs.find((r) => !r.combo) ?? refs[0];
    const combos = base ? refs.filter((r) => r !== base) : refs;

    if (base) {
      const style = await this.mat.getOrCreateStyle(base);
      if (style) {
        const overrideClasses = [...combos.flatMap((c) => c.classes), ...extra];
        if (overrideClasses.length > 0) {
          const full = `${style.classes} ${overrideClasses.join(' ')}`.trim();
          const design = buildDesign(full);
          return {
            classes: full,
            design,
            styleId: style.id,
            styleOverrides: { classes: full, design },
          };
        }
        return { classes: style.classes, design: style.design, styleId: style.id };
      }
    }

    // No reusable style (none present, or creation failed): inline everything.
    const all = [...refs.flatMap((r) => r.classes), ...extra].join(' ').trim();
    return { classes: all, design: buildDesign(all) };
  }

  private applyStyling(layer: Layer, styling: ResolvedStyling): void {
    layer.classes = styling.classes;
    if (styling.design) layer.design = styling.design;
    if (styling.styleId) layer.styleId = styling.styleId;
    if (styling.styleOverrides) layer.styleOverrides = styling.styleOverrides;
  }

  private async convertBox(node: ImportNode, isLink: boolean): Promise<Layer> {
    const styling = await this.resolveStyling(node);
    const tag = node.tag?.toLowerCase();
    const name = tag === 'section' ? 'section' : tag === 'form' ? 'form' : 'div';

    const layer: Layer = { id: generateId('lyr'), name, classes: '' };
    this.applyStyling(layer, styling);

    if (node.displayName) layer.customName = node.displayName;

    if (tag && tag !== name && SEMANTIC_TAGS.has(tag)) {
      layer.settings = { ...layer.settings, tag };
    }

    if (isLink && node.link?.href) {
      const link: LinkSettings = {
        type: 'url',
        url: { type: 'dynamic_text', data: { content: node.link.href } },
      };
      if (node.link.target) link.target = node.link.target as LinkSettings['target'];
      if (node.link.rel) link.rel = node.link.rel;
      layer.variables = { ...layer.variables, link };
    }

    const children = node.children ? await this.convertNodes(node.children) : [];
    if (children.length > 0) {
      layer.children = children;
    } else if (node.text) {
      layer.children = [this.makeTextLayer(node.text)];
    } else {
      layer.children = [];
    }

    return layer;
  }

  private async convertText(node: ImportNode): Promise<Layer> {
    const styling = await this.resolveStyling(node);
    const isHeading = node.kind === 'heading';
    const layer: Layer = {
      id: generateId('lyr'),
      name: isHeading ? 'heading' : 'text',
      classes: '',
      restrictions: { editText: true },
      variables: { text: makeRichTextVariable(node.text ?? '') },
    };
    this.applyStyling(layer, styling);

    if (isHeading && node.tag && /^h[1-6]$/.test(node.tag)) {
      layer.settings = { ...layer.settings, tag: node.tag };
    }

    return layer;
  }

  private async convertImage(node: ImportNode): Promise<Layer> {
    const styling = await this.resolveStyling(node);
    const img = node.image ?? {};

    let assetId = img.assetId;
    if (!assetId && img.src) {
      assetId = (await this.mat.uploadAsset(img.src)) ?? undefined;
    }

    const src = assetId
      ? { type: 'asset' as const, data: { asset_id: assetId } }
      : { type: 'dynamic_text' as const, data: { content: img.src ?? '' } };

    const layer: Layer = {
      id: generateId('lyr'),
      name: 'image',
      classes: '',
      variables: {
        image: {
          src,
          alt: { type: 'dynamic_text', data: { content: img.alt ?? '' } },
        },
      },
    };
    this.applyStyling(layer, styling);

    if (img.width || img.height) {
      layer.attributes = {
        ...layer.attributes,
        ...(img.width ? { width: img.width } : {}),
        ...(img.height ? { height: img.height } : {}),
      };
    }

    return layer;
  }

  private async convertIcon(node: ImportNode): Promise<Layer | null> {
    if (!node.svg) return null;
    const styling = await this.resolveStyling(node);
    const layer: Layer = {
      id: generateId('lyr'),
      name: 'icon',
      classes: '',
      variables: { icon: { src: { type: 'static_text', data: { content: node.svg } } } },
    };
    this.applyStyling(layer, styling);
    return layer;
  }

  private async convertCollection(node: ImportNode): Promise<Layer> {
    const styling = await this.resolveStyling(node);
    const layer: Layer = {
      id: generateId('lyr'),
      name: 'div',
      classes: '',
      // Empty placeholder — the user re-links this to a real Ycode collection.
      variables: { collection: { id: '' } },
    };
    this.applyStyling(layer, styling);

    const template = node.children ? await this.convertNodes(node.children) : [];
    layer.children = template.length > 0
      ? template
      : [{ id: generateId('lyr'), name: 'div', classes: '', children: [] }];

    return layer;
  }

  private makeTextLayer(text: string): Layer {
    return {
      id: generateId('lyr'),
      name: 'text',
      classes: '',
      restrictions: { editText: true },
      variables: { text: makeRichTextVariable(text) },
    };
  }
}
