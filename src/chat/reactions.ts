// Team Chat v2 reactions (Nov 13, Figma 09 · Proposals → 27b, picker 683:1335). Plain TypeScript, no React, so the
// server tests can check it against server/chat.mjs (REACTIONS). The server only accepts what's listed here.
//   • Quick: one tap from the hover toolbar (and the phone's long-press sheet).
//   • For service: words a restaurant already says, as reactions. Stored as the word ("Heard").
//   • The picker: search, For Service, Quick, Food and Drink.

export type Reaction = { key: string; name: string; icon: string; word?: boolean };

export const QUICK = ['👍', '✅', '🔥', '👀'];

export const SERVICE: Reaction[] = [
  { key: '86’d', name: '86’d', icon: '🚫', word: true },
  { key: 'Heard', name: 'Heard', icon: '👂', word: true },
  { key: 'Behind', name: 'Behind', icon: '↩️', word: true },
  { key: 'Corner', name: 'Corner', icon: '📐', word: true },
  { key: 'Hands', name: 'Hands', icon: '🙌', word: true },
  { key: 'Yes Chef', name: 'Yes Chef', icon: '👨‍🍳', word: true },
];

const e = (icon: string, name: string): Reaction => ({ key: icon, name, icon });
export const PICKER_QUICK: Reaction[] = [e('👍', 'Thumbs up'), e('✅', 'Done'), e('🔥', 'Fire'), e('👀', 'Eyes'), e('🙏', 'Thank you'), e('❤️', 'Heart'), e('😂', 'Laughing'), e('🎉', 'Party')];
export const FOOD: Reaction[] = [
  e('🍋', 'Lemon'), e('🍊', 'Orange'), e('🌶️', 'Chili'), e('🧂', 'Salt'), e('🍸', 'Cocktail'), e('🍹', 'Tropical drink'), e('🥃', 'Whiskey'), e('🍷', 'Wine'),
  e('🥩', 'Steak'), e('🐟', 'Fish'), e('🦞', 'Lobster'), e('🍝', 'Pasta'), e('🥗', 'Salad'), e('🍰', 'Cake'), e('☕', 'Coffee'), e('🧊', 'Ice'),
];

/** Every reaction the server accepts, in the order chips sort by (after their counts). */
export const ALL: Reaction[] = [...PICKER_QUICK, ...FOOD, ...SERVICE];
const byKey = new Map(ALL.map((r) => [r.key, r]));
/** The reaction for a stored key; an unknown key (an old reaction) shows as itself. */
export const reactionOf = (key: string): Reaction => byKey.get(key) || { key, name: key, icon: key };

/** "👍 4, you reacted" / "Heard 2" — a chip's name for screen readers. */
export function chipLabel(key: string, count: number, mine: boolean) {
  const r = reactionOf(key);
  return `${r.word ? r.name : r.icon} ${count}${mine ? ', you reacted' : ''}`;
}

/** Picker search: by name, or the word itself ("86", "heard", "fire"). */
export function findReactions(q: string): Reaction[] {
  const t = q.trim().toLowerCase().replace(/[’']/g, '');
  if (!t) return [];
  return ALL.filter((r) => r.name.toLowerCase().replace(/[’']/g, '').split(/\s+/).some((w) => w.startsWith(t)) || r.name.toLowerCase().replace(/[’']/g, '').startsWith(t));
}
