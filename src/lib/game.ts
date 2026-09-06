export const ROOM_STATUS = {
  LOBBY: 'LOBBY',
  SETUP: 'SETUP',
  READY: 'READY',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export type PlayerNumber = 1 | 2;

export type PlayerInfo = {
  uid: string;
  name: string;
  ready: boolean;
  playerNumber: PlayerNumber;
};

export type Room = {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  createdAt: number;
  lastActivityAt: number;
  player1?: PlayerInfo;
  player2?: PlayerInfo;
  currentTurn: PlayerNumber | null;
  currentWordIndex: number;
  player1Score: number;
  player2Score: number;
  winner: string | null;
  wordCount: number;
  player1Patterns: string[];
  player2Patterns: string[];
  player1Revealed: boolean[];
  player2Revealed: boolean[];
  player1Ready: boolean;
  player2Ready: boolean;
};

export type PrivateAnswers = {
  answers: string[];
  normalizedAnswers: string[];
};

export function normalizeWord(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidWord(value: string): boolean {
  const word = normalizeWord(value);
  if (!word) return false;
  if (word.length < 2 || word.length > 15) return false;
  return /^[A-Z]+$/.test(word);
}

export function maskWord(word: string): string {
  const cleaned = normalizeWord(word);
  if (!cleaned) return '';
  return `${cleaned[0]}${'-'.repeat(Math.max(0, cleaned.length - 1))}`;
}

export function buildWordPatterns(words: string[]): string[] {
  return words.map((word) => maskWord(word));
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createEmptyRoom(roomId: string, roomCode: string): Room {
  return {
    roomId,
    roomCode,
    status: ROOM_STATUS.LOBBY,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    currentTurn: null,
    currentWordIndex: 0,
    player1Score: 0,
    player2Score: 0,
    winner: null,
    wordCount: 0,
    player1Patterns: [],
    player2Patterns: [],
    player1Revealed: [],
    player2Revealed: [],
    player1Ready: false,
    player2Ready: false,
  };
}

export function canRoomAcceptPlayer(room: Room | null | undefined): boolean {
  if (!room) return false;
  return Boolean(room.player1 && !room.player2 && room.status !== ROOM_STATUS.FINISHED);
}

export function getPlayerKey(room: Room, playerNumber: PlayerNumber): 'player1' | 'player2' {
  return playerNumber === 1 ? 'player1' : 'player2';
}

export function getCurrentPlayerName(room: Room): string {
  if (!room.currentTurn) return 'Waiting';
  const player = room.currentTurn === 1 ? room.player1 : room.player2;
  return player?.name ?? 'Player';
}

export function getOpponentPlayerNumber(playerNumber: PlayerNumber): PlayerNumber {
  return playerNumber === 1 ? 2 : 1;
}

export function getPlayerByUid(room: Room, uid: string): PlayerInfo | null {
  if (room.player1?.uid === uid) return room.player1;
  if (room.player2?.uid === uid) return room.player2;
  return null;
}

export function isPlayerTurn(room: Room, uid: string): boolean {
  const player = getPlayerByUid(room, uid);
  if (!player || !room.currentTurn) return false;
  return player.playerNumber === room.currentTurn;
}

export function sanitizeWords(values: string[]): string[] {
  return values
    .map((value) => normalizeWord(value))
    .filter((value) => value.length > 0)
    .filter(isValidWord);
}

export function getRoomPatternsForPlayer(room: Room, playerNumber: PlayerNumber): string[] {
  return playerNumber === 1 ? room.player1Patterns : room.player2Patterns;
}

export function getWordMaskForPlayer(room: Room, playerNumber: PlayerNumber, index: number): string {
  const patterns = getRoomPatternsForPlayer(room, playerNumber);
  return patterns[index] ?? '';
}
