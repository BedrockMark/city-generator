// Characters: layered composition (body -> eyes -> outfit -> hairstyle -> accessory) with theme-aware outfits.
import { Rng } from './rng';
import { CHARS } from './assets';

export type Dir = 'right' | 'up' | 'left' | 'down';
const DIR_I: Record<Dir, number> = { right: 0, up: 1, left: 2, down: 3 };
export type Pose = 'stand' | 'walk' | 'sit' | 'phone';

const outfitGroup = (f: string) => {
  const n = f.split('/').pop()!.replace('.png', '').replace('Outfit_', '');
  return n.split('_')[0];
};
const accGroup = (f: string) => f.split('/').pop()!.replace('.png', '').replace(/_16x16$/, '').replace(/_\d+$/, '');

/** outfit groups considered everyday clothes (no profession / costume / swimwear) */
function casualOutfits(): string[] {
  const special = new Set(Object.keys(CHARS.themes.outfits));
  return CHARS.layers.Outfits.filter(f => {
    const g = outfitGroup(f);
    return !special.has(g) || ['05', '06', '22', '26', '27', '19'].includes(g);   // suits & sport are fine downtown
  });
}
const CASUAL = casualOutfits();
const CASUAL_ACC = CHARS.layers.Accessories.filter(f => /Backpack|Snapback_\d|Beanie|Mustache|Beard|Glasses|Gloves/.test(f) && !/Dino|Scout|Policeman/.test(f));

export interface Person { layers: string[]; kid: boolean; role: string }

export function makePerson(r: Rng, role = 'citizen', o: { kid?: boolean } = {}): Person {
  const L = CHARS.layers;
  const kid = o.kid ?? false;
  if (kid) {
    const outfit = r.pick(L.Outfits_kids);
    const noHair = /pajama/.test(outfit);
    return { kid, role, layers: [r.pick(L.Bodies_kids), r.pick(L.Eyes_kids), outfit, ...(noHair ? [] : [r.pick(L.Hairstyles_kids)])] };
  }
  let outfit = r.pick(CASUAL);
  let acc: string | null = r.chance(0.28) ? r.pick(CASUAL_ACC) : null;
  const byGroup = (g: string) => L.Outfits.filter(f => outfitGroup(f) === g);
  const accBy = (rx: RegExp) => L.Accessories.filter(f => rx.test(f));
  if (role === 'police') { outfit = r.pick(byGroup('29')); acc = r.pick(accBy(/Policeman_Hat/)); }
  if (role === 'postman') { outfit = r.pick(byGroup('Postman')); acc = r.pick(accBy(/Postman/)); }
  if (role === 'worker') { acc = r.pick(accBy(/Worker_Helmet|Worker_Jacket/)); }
  if (role === 'chef') { acc = r.pick(accBy(/Chef/)); }
  if (role === 'business') { outfit = r.pick([...byGroup('05'), ...byGroup('06'), ...byGroup('22'), ...byGroup('26'), ...byGroup('27')]); acc = r.chance(0.2) ? r.pick(accBy(/Glasses/)) : null; }
  const hair = r.pick(L.Hairstyles);
  const layers = [r.pick(L.Bodies), r.pick(L.Eyes), outfit, hair, ...(acc ? [acc] : [])];
  void accGroup;
  return { kid, role, layers };
}

/** frame [col,row] in the 16x32 grid */
export function frameFor(p: Person, pose: Pose, dir: Dir, r?: Rng): [number, number] {
  const d = DIR_I[dir];
  if (p.kid || pose === 'stand') return [d * 6, 1];
  if (pose === 'walk') return [d * 6 + (r ? r.int(0, 5) : 1), 2];
  if (pose === 'sit') return [dir === 'left' ? 6 : 0, 4];            // sit row: right block 0-5, left block 6-11
  if (pose === 'phone') return [dir === 'left' ? 10 : 4, 6];        // inside the 4-9 "phone" loop
  return [d * 6, 1];
}
