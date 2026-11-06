/**
 * Picks an emoji for a category from its name (Khmer or English), so categories created by a POS
 * import (or by hand without choosing one) don't all show the same 🛒.
 * Rules are checked in order: the first matching word wins.
 */
const RULES: [RegExp, string][] = [
  [/សាប៊ូលាងដៃ|hand ?wash|hand ?soap/i, '🧼'],
  [/សាប៊ូ|detergent|laundry|soap/i, '🫧'],
  [/skin|ក្រែម|lotion|cream|cosmetic|គ្រឿងសំអាង/i, '🧴'],
  [/foam|shampoo|សាប៊ូកក់សក់|hair/i, '🧖'],
  [/spray|បាញ់|mosquito|មូស|insect/i, '💨'],
  [/ទឹកអប់|perfume|fragrance/i, '🌸'],
  [/កន្ត្រក|basket/i, '🧺'],
  [/តុក្កតា|toy|ក្មេង|baby|kid/i, '🧸'],
  [/ប៉ៅ|តុ|table/i, '🍽️'],
  [/កៅអី|chair|stool/i, '🪑'],
  [/គ្រែ|bed|mattress|ពូក/i, '🛏️'],
  [/ជូក|អំបោស|broom|dustpan/i, '🧹'],
  [/ធុងសម្រាម|សម្រាម|trash|rubbish|garbage|bin/i, '🗑️'],
  [/ធុងជូត|mop|ជូត/i, '🧽'],
  [/ធុងទឹក|ធុង|bucket|tank|barrel/i, '🪣'],
  [/ប្រអប់|box|storage|container/i, '📦'],
  [/ចាន|ឆ្នាំង|kitchen|cook|plate|bowl|pot/i, '🍳'],
  [/ទឹកដោះ|milk|dairy/i, '🥛'],
  [/ភេសជ្ជៈ|drink|beverage|ទឹក/i, '🥤'],
  [/ផ្សេងៗ|other|misc/i, '🛍️'],
];

export function guessCategoryEmoji(...names: (string | null | undefined)[]): string | null {
  const text = names.filter(Boolean).join(' ');
  for (const [re, emoji] of RULES) if (re.test(text)) return emoji;
  return null;
}

export const DEFAULT_EMOJI = '🛒';
