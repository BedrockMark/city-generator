// Asset metadata access (data exported by tools/export_manifest.py).
import spritesRaw from './data/sprites.json';
import modularRaw from './data/modular.json';
import autotileRaw from './data/autotile.json';
import charsRaw from './data/characters.json';

export interface SpriteInfo { key: string; file: string; w: number; h: number; bb: [number, number, number, number] }

const SPRITES = spritesRaw as unknown as Record<string, [string, number, number, number, number, number, number]>;

export function spr(key: string): SpriteInfo {
  const v = SPRITES[key];
  if (!v) throw new Error(`unknown sprite ${key}`);
  return { key, file: v[0], w: v[1], h: v[2], bb: [v[3], v[4], v[5], v[6]] };
}
export function hasSprite(key: string): boolean { return key in SPRITES; }

/** all keys "<pack>/<base>_<n>" for a given "<pack>/<base>" (numbered variants), optionally filtered */
export function variants(base: string, nums?: number[]): string[] {
  const out: string[] = [];
  const rx = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)$');
  for (const k of Object.keys(SPRITES)) {
    const m = k.match(rx);
    if (m && (!nums || nums.includes(+m[1]))) out.push(k);
  }
  return out.sort((a, b) => +a.split('_').pop()! - +b.split('_').pop()!);
}

export interface ModPiece { key: string; colour: 'red' | 'blue' | 'grey' | 'any'; h: number; v: number }
export const MODULAR = modularRaw as unknown as Record<string, ModPiece[]>;

export type AutotileTable = { row0: number; masks: Record<string, [number, number]> };
export const AUTOTILE = autotileRaw as unknown as Record<string, AutotileTable>;

export interface CharData {
  layers: Record<string, string[]>;
  themes: { outfits: Record<string, { theme: string }>; accessories: Record<string, string> };
}
export const CHARS = charsRaw as unknown as CharData;
