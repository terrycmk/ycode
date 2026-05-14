import { NextRequest, NextResponse } from 'next/server';
import { setSettings } from '@/lib/repositories/settingsRepository';
import { clearAllCache } from '@/lib/services/cacheService';

/**
 * Setting keys that don't affect public-page rendering. Mirrors the list in
 * /ycode/api/settings/[key]/route.ts — keep them in sync.
 */
const DRAFT_ONLY_SETTING_KEYS = new Set(['draft_css', 'email']);

/**
 * PUT /ycode/api/settings/batch
 *
 * Update multiple settings at once.
 * Invalidates the public page cache so ISR pages pick up the new values.
 * Request body: { settings: { key1: value1, key2: value2, ... } }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid settings object in request body' },
        { status: 400 }
      );
    }

    const count = await setSettings(settings);

    // Only invalidate caches if any of the updated keys actually affect
    // public page rendering. Skips builder-only autosaves.
    const touchesPublicKeys = Object.keys(settings).some(
      (key) => !DRAFT_ONLY_SETTING_KEYS.has(key)
    );
    if (touchesPublicKeys) {
      await clearAllCache();
    }

    return NextResponse.json({
      data: { count },
      message: `Updated ${count} setting(s) successfully`,
    });
  } catch (error) {
    console.error('[API] Error updating settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
