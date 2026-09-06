import { createEmptyRoom, type Room, type PlayerInfo } from '@/lib/game';

const ROOM_PREFIX = 'word-duel-room:';
const SESSION_PREFIX = 'word-duel-session:';

export function readRoomFromStorage(roomId: string): Room | null {
  if (typeof window === 'undefined') return null;
  const json = window.localStorage.getItem(`${ROOM_PREFIX}${roomId}`);
  if (!json) return null;
  try {
    return JSON.parse(json) as Room;
  } catch {
    return null;
  }
}

export function saveRoomToStorage(room: Room): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${ROOM_PREFIX}${room.roomId}`, JSON.stringify(room));
}

export function removeRoomFromStorage(roomId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${ROOM_PREFIX}${roomId}`);
}

export function getSession(): { roomId: string; uid: string; name: string; role: 'player1' | 'player2' } | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_PREFIX);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { roomId: string; uid: string; name: string; role: 'player1' | 'player2' };
  } catch {
    return null;
  }
}

export function saveSession(session: { roomId: string; uid: string; name: string; role: 'player1' | 'player2' }): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_PREFIX, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_PREFIX);
}

export function ensureRoomInStorage(roomId: string, roomCode: string): Room {
  const existing = readRoomFromStorage(roomId) ?? createEmptyRoom(roomId, roomCode);
  const sync = { ...existing, roomId, roomCode, lastActivityAt: Date.now() };
  saveRoomToStorage(sync);
  return sync;
}

export function hydratePlayerSession(room: Room, uid: string, name: string): { role: 'player1' | 'player2'; roomId: string } | null {
  if (room.player1?.uid === uid) {
    return { role: 'player1', roomId: room.roomId };
  }
  if (room.player2?.uid === uid) {
    return { role: 'player2', roomId: room.roomId };
  }
  if (!room.player1 && !room.player2 && name) {
    return { role: 'player1', roomId: room.roomId };
  }
  return null;
}

export type StoredSession = {
  roomId: string;
  uid: string;
  name: string;
  role: 'player1' | 'player2';
};

export function hasStoredSession(): boolean {
  return Boolean(getSession());
}

export function getPlayerBySession(room: Room | null, session: StoredSession | null): PlayerInfo | null {
  if (!room || !session) return null;
  const role = session.role === 'player1' ? 'player1' : 'player2';
  return room[role] ?? null;
}
