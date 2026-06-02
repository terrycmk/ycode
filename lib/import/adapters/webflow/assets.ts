/**
 * Webflow image extraction.
 *
 * Webflow image nodes already carry an absolute CDN URL in `data.attr.src`, so
 * the IR keeps that URL; the shared materializer re-hosts it into Ycode assets
 * at conversion time (falling back to the remote URL if the fetch is blocked).
 */

import type { ImportImage } from '@/lib/import/types';
import type { XscpNode } from '@/lib/import/adapters/webflow/xscp-types';

const DECORATIVE_ALT = '__wf_reserved_decorative';

export function imageFromNode(node: XscpNode): ImportImage {
  const attr = node.data?.attr ?? {};
  const alt = attr.alt && attr.alt !== DECORATIVE_ALT ? attr.alt : '';
  const width = attr.width && attr.width !== 'auto' ? attr.width : undefined;
  const height = attr.height && attr.height !== 'auto' ? attr.height : undefined;

  return {
    src: attr.src || undefined,
    alt,
    width,
    height,
  };
}
