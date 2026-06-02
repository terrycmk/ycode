/**
 * Webflow XSCP → neutral import IR.
 *
 * Rebuilds the tree from the flat `nodes[]` array (hierarchy lives in
 * `children: [id]`) and maps each Webflow node type onto an `ImportNode`.
 */

import type { ImportDocument, ImportNode, ImportStyleRef } from '@/lib/import/types';
import { buildStyleResolver, extractFontFamilies } from '@/lib/import/adapters/webflow/styles';
import { imageFromNode } from '@/lib/import/adapters/webflow/assets';
import { buildCollectionNode, isCollectionWrapper, isDynamoType } from '@/lib/import/adapters/webflow/collections';
import type { WebflowParseContext, XscpNode, XscpPayload } from '@/lib/import/adapters/webflow/xscp-types';

const HEADING_TAGS = /^h[1-6]$/;

/** Join a sequence of text-leaf / line-break children into one string. */
function collectText(childNodes: XscpNode[]): string {
  return childNodes
    .map((n) => (n.type === 'LineBreak' ? '\n' : n.v ?? ''))
    .join('');
}

/** True when every child is a text leaf or a line break (a text element). */
function isTextual(childNodes: XscpNode[]): boolean {
  return childNodes.length > 0 && childNodes.every((n) => n.text === true || n.type === 'LineBreak');
}

export function parseWebflow(data: XscpPayload): ImportDocument {
  const nodes = data.payload?.nodes ?? [];
  const styles = data.payload?.styles ?? [];

  const byId = new Map<string, XscpNode>();
  for (const node of nodes) byId.set(node._id, node);

  const resolveStyle = buildStyleResolver(styles);
  const resolveStyles = (classIds: string[] | undefined): ImportStyleRef[] =>
    (classIds ?? []).map(resolveStyle).filter((r): r is ImportStyleRef => r !== null);

  const ctx: WebflowParseContext = {
    byId,
    resolveStyle,
    resolveStyles,
    buildNode: (node) => buildNode(node, ctx),
  };

  // Roots = element nodes that are never referenced as someone's child.
  const childIds = new Set<string>();
  for (const node of nodes) {
    for (const childId of node.children ?? []) childIds.add(childId);
  }
  const roots = nodes
    .filter((n) => !childIds.has(n._id) && !n.text)
    .map((n) => buildNode(n, ctx))
    .filter((n): n is ImportNode => n !== null);

  const fonts = extractFontFamilies(styles).map((family) => ({ family }));

  return { roots, fonts, source: 'Webflow' };
}

function buildNode(node: XscpNode | undefined, ctx: WebflowParseContext): ImportNode | null {
  if (!node) return null;

  // Bare text leaf surfacing as a root.
  if (node.text === true) {
    return { kind: 'text', text: node.v ?? '' };
  }

  const type = node.type;

  // Collection lists.
  if (isDynamoType(type)) {
    if (isCollectionWrapper(type)) return buildCollectionNode(node, ctx);
    return null; // list / item / empty consumed by the wrapper.
  }

  // Webflow built-in widget icons carry no markup we can import.
  if (type === 'Icon') return null;

  const childNodes = (node.children ?? [])
    .map((id) => ctx.byId.get(id))
    .filter((n): n is XscpNode => n !== undefined);
  const styles = ctx.resolveStyles(node.classes);
  const displayName = typeof node.data?.displayName === 'string' && node.data.displayName ? node.data.displayName : undefined;

  if (type === 'Image') {
    return { kind: 'image', styles, image: imageFromNode(node), displayName };
  }

  if (type === 'Link') {
    const href = node.data?.link?.href || node.data?.attr?.href;
    const link = href ? { href } : undefined;
    const base: ImportNode = { kind: 'link', tag: 'a', styles, link, displayName };
    if (isTextual(childNodes)) {
      base.text = collectText(childNodes);
    } else {
      base.children = childNodes.map((c) => buildNode(c, ctx)).filter((n): n is ImportNode => n !== null);
    }
    return base;
  }

  if (type === 'Heading') {
    return { kind: 'heading', tag: node.tag, styles, text: collectText(childNodes), displayName };
  }

  if (isTextual(childNodes)) {
    return { kind: 'text', tag: node.tag, styles, text: collectText(childNodes), displayName };
  }

  const children = childNodes.map((c) => buildNode(c, ctx)).filter((n): n is ImportNode => n !== null);
  return { kind: 'box', tag: node.tag, styles, displayName, children };
}
