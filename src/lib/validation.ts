import { isValidWord, normalizeWord } from '@/lib/game';

export function validateRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return 'Room code must be 6 characters.';
  return null;
}

export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length < 2 || trimmed.length > 20) return 'Name must be 2–20 characters.';
  return null;
}

export function validateWordList(values: string[], minimum = 3, maximum = 10): string | null {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length < minimum || cleaned.length > maximum) {
    return `Please enter between ${minimum} and ${maximum} valid words.`;
  }

  for (const word of cleaned) {
    if (!isValidWord(word)) {
      return 'Each word must be 2–15 letters only.';
    }
  }

  return null;
}

export function validateGuess(value: string): string | null {
  const guess = normalizeWord(value);
  if (!guess) return 'Guess cannot be empty.';
  if (!isValidWord(guess)) return 'Guess must be 2–15 letters only.';
  return null;
}
