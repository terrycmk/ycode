/**
 * Webflow class → reusable style resolution.
 *
 * Each Webflow class becomes one `ImportStyleRef` whose `classes` already
 * include responsive (`max-lg:` / `max-md:`) and state (`hover:` / `active:` /
 * `focus:`) prefixes derived from the class's `variants`. Combo classes
 * (`comb === '&'`) are flagged so the converter stacks them as overrides.
 */

import type { ImportStyleRef } from '@/lib/import/types';
import { cssToClasses } from '@/lib/import/css';
import type { XscpStyle } from '@/lib/import/adapters/webflow/xscp-types';

/**
 * Webflow breakpoints are desktop-first. Map each to Ycode's desktop-first
 * Tailwind prefixes. Ycode has no dedicated "tiny" tier, so it folds into
 * mobile (`max-md:`).
 */
const BREAKPOINT_PREFIX: Record<string, string> = {
  main: '',
  medium: 'max-lg:',
  small: 'max-md:',
  tiny: 'max-md:',
};

const STATE_PREFIX: Record<string, string> = {
  hover: 'hover:',
  active: 'active:',
  pressed: 'active:',
  focus: 'focus:',
};

const BREAKPOINTS = new Set(Object.keys(BREAKPOINT_PREFIX));

/**
 * Turn a variant key (e.g. `medium_hover`) into a Tailwind variant prefix.
 * Returns null for variants Ycode can't represent (e.g. `*_current`).
 */
function variantPrefix(key: string): string | null {
  const parts = key.split('_');
  let bp = 'main';
  let state: string | undefined;

  if (BREAKPOINTS.has(parts[0])) {
    bp = parts[0];
    state = parts[1];
  } else {
    state = parts[0];
  }

  const bpPrefix = BREAKPOINT_PREFIX[bp] ?? '';
  if (!state) return bpPrefix;

  const statePrefix = STATE_PREFIX[state];
  if (!statePrefix) return null; // Unsupported state (e.g. current/visited).
  return `${bpPrefix}${statePrefix}`;
}

/** Build the full prefixed class list for a Webflow style. */
function resolveStyleClasses(style: XscpStyle): string[] {
  const classes: string[] = cssToClasses(style.styleLess || '');

  for (const [key, variant] of Object.entries(style.variants ?? {})) {
    if (!variant?.styleLess) continue;
    const prefix = variantPrefix(key);
    if (prefix === null) continue;
    for (const cls of cssToClasses(variant.styleLess)) {
      classes.push(`${prefix}${cls}`);
    }
  }

  return classes;
}

/**
 * Build a resolver mapping a Webflow class id to a reusable style ref.
 * Resolution is memoised so each class is converted once per paste.
 */
export function buildStyleResolver(styles: XscpStyle[]): (classId: string) => ImportStyleRef | null {
  const byId = new Map<string, XscpStyle>();
  for (const style of styles) byId.set(style._id, style);

  const cache = new Map<string, ImportStyleRef | null>();

  return (classId: string): ImportStyleRef | null => {
    if (cache.has(classId)) return cache.get(classId) ?? null;

    const style = byId.get(classId);
    if (!style) {
      cache.set(classId, null);
      return null;
    }

    const classes = resolveStyleClasses(style);
    const ref: ImportStyleRef = {
      key: classId,
      name: style.name || 'Imported',
      classes,
      combo: style.comb === '&',
    };
    cache.set(classId, ref);
    return ref;
  };
}

/** Extract referenced font families from all styles (for installation). */
export function extractFontFamilies(styles: XscpStyle[]): string[] {
  const families = new Set<string>();
  const generic = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

  for (const style of styles) {
    const sources = [style.styleLess, ...Object.values(style.variants ?? {}).map((v) => v?.styleLess ?? '')];
    for (const css of sources) {
      const match = css.match(/font-family:\s*([^;]+)/i);
      if (!match) continue;
      const family = match[1].split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (family && !generic.has(family.toLowerCase())) families.add(family);
    }
  }

  return [...families];
}
