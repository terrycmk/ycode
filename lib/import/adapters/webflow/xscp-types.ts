/**
 * Typed shape of Webflow's `@webflow/XscpData` clipboard payload.
 *
 * Only the fields the importer relies on are modelled; everything else is left
 * loose. Derived from real clipboard captures.
 */

import type { ImportNode, ImportStyleRef } from '@/lib/import/types';

export const XSCP_TYPE = '@webflow/XscpData';

/** A flat node entry. Either an element (with `type`) or a text leaf. */
export interface XscpNode {
  _id: string;
  /** Element type, e.g. 'Block' | 'Section' | 'Link' | 'Image' | 'Heading' | 'Dynamo*' | 'Slider*'. */
  type?: string;
  /** True for text leaves; their string lives in `v`. */
  text?: boolean;
  v?: string;
  tag?: string;
  classes?: string[];
  children?: string[];
  data?: XscpNodeData;
}

export interface XscpNodeData {
  tag?: string;
  displayName?: string;
  attr?: Record<string, string>;
  link?: { mode?: string; href?: string; target?: string };
  img?: { id?: string };
  dyn?: { type?: string; grid?: number };
  widget?: { type?: string; icon?: string };
  sym?: { inst?: string };
  [key: string]: unknown;
}

/** A Webflow style (class) definition. */
export interface XscpStyle {
  _id: string;
  type?: string;
  name: string;
  /** Combinator: '' for a base class, '&' for a combo/modifier class. */
  comb?: string;
  /** Raw CSS for the base (desktop) breakpoint. */
  styleLess: string;
  /** Per-variant CSS keyed by `<breakpoint>` or `<breakpoint>_<state>`. */
  variants?: Record<string, { styleLess?: string }>;
}

export interface XscpAsset {
  cdnUrl?: string;
  fileName?: string;
  width?: number;
  height?: number;
}

export interface XscpPayload {
  type: string;
  payload: {
    nodes: XscpNode[];
    styles: XscpStyle[];
    assets?: XscpAsset[];
    ix1?: unknown[];
    ix2?: unknown;
  };
  meta?: Record<string, unknown>;
}

/** Shared context threaded through the Webflow parser. */
export interface WebflowParseContext {
  byId: Map<string, XscpNode>;
  /** Resolve a Webflow class id to a reusable style ref (null if unknown/empty). */
  resolveStyle: (classId: string) => ImportStyleRef | null;
  /** Resolve a node's class id list into style refs (base first). */
  resolveStyles: (classIds: string[] | undefined) => ImportStyleRef[];
  buildNode: (node: XscpNode | undefined) => ImportNode | null;
}
