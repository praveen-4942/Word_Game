'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ensureAnonymousUser,
  findFirebaseRoomByCode,
  isFirebaseConfigured,
  watchFirebaseRoom,
  writeFirebaseRoom,
} from '@/lib/firebase';

type RoomStatus = 'SETUP' | 'PLAYING' | 'FINISHED';
type PlayerNumber = 1 | 2;

type Player = {
  uid: string;
  name: string;
  playerNumber: PlayerNumber;
};

type GuessRecord = {
  word: string;
  correct: boolean;
  wordIndex: number;
};

type Room = {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  player1?: Player;
  player2?: Player;
  words1: string[];
  words2: string[];
  wordCount: number;
  currentTurn: PlayerNumber | null;
  currentWordIndex: number;
  player1WordIndex: number;
  player2WordIndex: number;
  player1Score: number;
  player2Score: number;
  winner: string | null;
  wordPatterns1: string[];
  wordPatterns2: string[];
  revealed1: boolean[];
  revealed2: boolean[];
  player1Guesses: GuessRecord[];
  player2Guesses: GuessRecord[];
  turnStartedAt: number | null;
  createdAt?: number;
  lastActivityAt?: number;
};

type Session = {
  roomId: string;
  uid: string;
  name: string;
  role: 'player1' | 'player2';
};

const ROOM_KEY = 'word-duel-rooms';
const SESSION_KEY = 'word-duel-session';
const TURN_DURATION_SECONDS = 30;

const normalizeWord = (value: string) => value.trim().toUpperCase();

const maskWord = (value: string) => {
  const cleaned = normalizeWord(value);
  if (!cleaned) return '';
  return `${cleaned[0]}${'•'.repeat(Math.max(0, cleaned.length - 1))}`;
};

const generateRoomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

const readRooms = (): Record<string, Room> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROOM_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Room>) : {};
  } catch {
    return {};
  }
};

const writeRooms = (rooms: Record<string, Room>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ROOM_KEY, JSON.stringify(rooms));
};

const readSession = (): Session | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

const writeSession = (session: Session | null) => {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const createRoomRecord = (roomId: string, roomCode: string, player1: Player, wordCount: number): Room => ({
  roomId,
  roomCode,
  status: 'SETUP',
  player1,
  words1: [],
  words2: [],
  wordCount,
  currentTurn: null,
  currentWordIndex: 0,
  player1WordIndex: 0,
  player2WordIndex: 0,
  player1Score: 0,
  player2Score: 0,
  winner: null,
  wordPatterns1: [],
  wordPatterns2: [],
  revealed1: [],
  revealed2: [],
  player1Guesses: [],
  player2Guesses: [],
  turnStartedAt: null,
});

const getRoomByCode = (code: string): Room | null => {
  const rooms = readRooms();
  return Object.values(rooms).find((room) => room.roomCode.toUpperCase() === code.toUpperCase()) ?? null;
};

const getOpponentNumber = (playerNumber: PlayerNumber): PlayerNumber => (playerNumber === 1 ? 2 : 1);

const getCurrentPlayerLabel = (room: Room) =>
  room.currentTurn === 1 ? room.player1?.name ?? 'Player 1' : room.player2?.name ?? 'Player 2';

const getOpponentWordList = (room: Room, playerNumber: PlayerNumber) =>
  playerNumber === 1 ? room.words2 : room.words1;

const isValidWordList = (words: string[]) => {
  const cleaned = words
    .map((word) => normalizeWord(word))
    .filter(Boolean)
    .filter((word) => /^[A-Z]+$/.test(word) && word.length >= 3 && word.length <= 15);

  return cleaned.length >= 3 && cleaned.length <= 20 ? cleaned : null;
};

export default function WordDuelApp({
  initialView = 'landing',
  roomCode,
}: {
  initialView?: 'landing' | 'create' | 'join' | 'rules' | 'room';
  roomCode?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<'landing' | 'create' | 'join' | 'rules' | 'room'>(initialView);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState(roomCode ?? '');
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [words, setWords] = useState<string[]>(Array(20).fill(''));
  const [selectedWordCount, setSelectedWordCount] = useState(20);
  const [guess, setGuess] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(TURN_DURATION_SECONDS);
  const [toast, setToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timedOutTurn = useRef<string | null>(null);

  useEffect(() => {
    const savedSession = readSession();
    // Session recovery must happen after hydration because localStorage is browser-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(savedSession);
    if (savedSession) {
      const rooms = readRooms();
      setRoom(rooms[savedSession.roomId] ?? null);
    }
  }, []);

  useEffect(() => {
    if (!session || !isFirebaseConfigured) return;
    return watchFirebaseRoom<Room>(session.roomId, (nextRoom) => {
      setRoom(nextRoom);
      const rooms = readRooms();
      rooms[nextRoom.roomId] = nextRoom;
      writeRooms(rooms);
    });
  }, [session]);

  const saveRoom = (nextRoom: Room) => {
    const rooms = readRooms();
    rooms[nextRoom.roomId] = nextRoom;
    writeRooms(rooms);
    setRoom(nextRoom);
    if (isFirebaseConfigured) {
      void writeFirebaseRoom(nextRoom).catch(() => {
        setToast('Could not sync with Firebase. Check Firestore rules.');
      });
    }
  };

  useEffect(() => {
    const roomWordCount = room?.wordCount ?? 0;
    if (roomWordCount > 0 && roomWordCount !== words.length) {
      // Resize the local form when the shared Firebase room count arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedWordCount(roomWordCount);
      setWords((previous) => Array.from({ length: roomWordCount }, (_, index) => previous[index] ?? ''));
    }
  }, [room?.wordCount, words.length]);

  useEffect(() => {
    if (!room || room.status !== 'PLAYING' || !room.currentTurn || !room.turnStartedAt) {
      const resetTimer = window.setTimeout(() => setSecondsRemaining(TURN_DURATION_SECONDS), 0);
      return () => window.clearTimeout(resetTimer);
    }

    const currentTurn = room.currentTurn;
    const turnKey = `${room.currentTurn}-${room.turnStartedAt}`;
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((room.turnStartedAt! + TURN_DURATION_SECONDS * 1000 - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining !== 0 || timedOutTurn.current === turnKey) return;

      timedOutTurn.current = turnKey;
      const nextRoom: Room = {
        ...room,
        currentTurn: getOpponentNumber(currentTurn),
        turnStartedAt: Date.now(),
      };
      saveRoom(nextRoom);
      setToast(`${getCurrentPlayerLabel(room)} ran out of time. Turn passed.`);
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(timer);
  }, [room]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const activeSession = readSession();
      if (!activeSession) return;
      const rooms = readRooms();
      setRoom(rooms[activeSession.roomId] ?? null);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const myNumber = useMemo(() => {
    if (!session || !room) return null;
    return session.role === 'player1' ? 1 : 2;
  }, [session, room]);

  const myPatterns = room && myNumber ? (myNumber === 1 ? room.wordPatterns2 : room.wordPatterns1) : [];
  const myRevealed = room && myNumber ? (myNumber === 1 ? room.revealed2 : room.revealed1) : [];
  const myWords = room && myNumber ? (myNumber === 1 ? room.words2 : room.words1) : [];
  const isMyTurn = Boolean(room && myNumber && room.currentTurn === myNumber);
  const currentWordIndex = room && myNumber
    ? (myNumber === 1 ? room.player1WordIndex : room.player2WordIndex)
    : 0;
  const currentPattern = room && myNumber
    ? (myNumber === 1 ? room.wordPatterns2[currentWordIndex] : room.wordPatterns1[currentWordIndex])
    : '';

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setToast('Name must be at least 2 characters.');
      return;
    }

    setIsSubmitting(true);
    setToast('Creating room...');
    try {
      const firebaseUser = isFirebaseConfigured ? await ensureAnonymousUser() : null;
      const roomId = `room-${Date.now()}`;
      const roomCodeValue = generateRoomCode();
      const player1: Player = { uid: firebaseUser?.uid ?? `uid-${Date.now()}`, name: trimmedName, playerNumber: 1 };
        const nextRoom = createRoomRecord(roomId, roomCodeValue, player1, selectedWordCount);
      const nextSession: Session = { roomId, uid: player1.uid, name: trimmedName, role: 'player1' };

      const rooms = readRooms();
      rooms[roomId] = nextRoom;
      writeRooms(rooms);
      if (isFirebaseConfigured) await writeFirebaseRoom(nextRoom);
      writeSession(nextSession);
      setSession(nextSession);
      setRoom(nextRoom);
      setView('room');
      router.push(`/room/${roomCodeValue}`);
      setToast('Room created');
    } catch {
      setToast('Unable to create room. Check Firebase setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setToast('Name must be at least 2 characters.');
      return;
    }

    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setToast('Room code must be 6 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      setToast('Joining room...');
      const firebaseUser = isFirebaseConfigured ? await ensureAnonymousUser() : null;
      const found = isFirebaseConfigured ? await findFirebaseRoomByCode<Room>(code) : getRoomByCode(code);
      if (!found) {
        setToast('Room not found. Check the room code.');
        return;
      }
      if (found.player1 && found.player2) {
        setToast('This room is full.');
        return;
      }

      const playerNumber: PlayerNumber = found.player1 ? 2 : 1;
      const player: Player = { uid: firebaseUser?.uid ?? `uid-${Date.now()}`, name: trimmedName, playerNumber };
      const nextRoom: Room = {
        ...found,
        ...(playerNumber === 1 ? { player1: player } : { player2: player }),
        status: 'SETUP',
        wordCount: found.wordCount ?? 0,
      };
      const nextSession: Session = { roomId: nextRoom.roomId, uid: player.uid, name: trimmedName, role: playerNumber === 1 ? 'player1' : 'player2' };

      await writeFirebaseRoom(nextRoom);
      saveRoom(nextRoom);
      writeSession(nextSession);
      setSession(nextSession);
      setView('room');
      router.push(`/room/${code}`);
      setToast('Joined room');
    } catch {
      setToast('Unable to join. Enable Anonymous Auth and publish Firestore rules.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitWords = (event: React.FormEvent) => {
    event.preventDefault();
    if (!room || !session) return;

    const playerNumber = session.role === 'player1' ? 1 : 2;
    const requiredWordCount = room.wordCount || selectedWordCount;
    if (playerNumber === 2 && !room.wordCount) {
      setToast('Wait for Player 1 to choose the word count.');
      return;
    }
    const nextRoom: Room = { ...room };

    const cleaned = isValidWordList(words);
    if (!cleaned || cleaned.length !== requiredWordCount) {
      setToast(`Enter exactly ${requiredWordCount} compound words.`);
      return;
    }

    if (playerNumber === 1) {
      nextRoom.words1 = cleaned;
      nextRoom.wordPatterns1 = cleaned.map((word) => maskWord(word));
      nextRoom.revealed1 = Array(cleaned.length).fill(false);
    } else {
      nextRoom.words2 = cleaned;
      nextRoom.wordPatterns2 = cleaned.map((word) => maskWord(word));
      nextRoom.revealed2 = Array(cleaned.length).fill(false);
    }

    nextRoom.wordCount = requiredWordCount;

    if (nextRoom.player1 && nextRoom.player2) {
      const bothReady = nextRoom.words1.length > 0 && nextRoom.words2.length > 0;
      nextRoom.status = bothReady ? 'PLAYING' : 'SETUP';
      if (bothReady) {
        nextRoom.currentTurn = Math.random() > 0.5 ? 1 : 2;
        nextRoom.turnStartedAt = Date.now();
      }
    }

    saveRoom(nextRoom);
    setWords(Array(requiredWordCount).fill(''));
    setToast(nextRoom.status === 'PLAYING' ? 'Both players are ready!' : 'Words submitted');
  };

  const handleGuess = (event: React.FormEvent) => {
    event.preventDefault();
    if (!room || !session || !myNumber || room.status !== 'PLAYING') {
      setToast('The game has not started yet.');
      return;
    }

    if (room.currentTurn !== myNumber) {
      setToast('It is not your turn.');
      return;
    }

    const opponentNumber = getOpponentNumber(myNumber);
    const guessingWordIndex = myNumber === 1
      ? (room.player1WordIndex ?? room.currentWordIndex)
      : (room.player2WordIndex ?? room.currentWordIndex);
    const opponentWords = getOpponentWordList(room, myNumber);
    const secretWord = opponentWords[guessingWordIndex] ?? '';
    const normalizedGuess = normalizeWord(guess);
    if (!/^[A-Z]+$/.test(normalizedGuess) || normalizedGuess.length < 3) {
      setToast('Guess must contain letters and be at least 3 characters.');
      return;
    }
    if (normalizedGuess.length !== secretWord.length) {
      setToast(`This target has ${secretWord.length} letters. Try again.`);
      return;
    }

    const nextRoom: Room = { ...room };
    const guessRecord: GuessRecord = {
      word: normalizedGuess,
      correct: normalizedGuess === normalizeWord(secretWord),
      wordIndex: guessingWordIndex,
    };
    if (myNumber === 1) {
      nextRoom.player1Guesses = [...(nextRoom.player1Guesses ?? []), guessRecord];
    } else {
      nextRoom.player2Guesses = [...(nextRoom.player2Guesses ?? []), guessRecord];
    }

    if (normalizedGuess === normalizeWord(secretWord)) {
      if (opponentNumber === 1) {
        nextRoom.revealed1[guessingWordIndex] = true;
      } else {
        nextRoom.revealed2[guessingWordIndex] = true;
      }

      if (myNumber === 1) {
        nextRoom.player1Score += 1;
      } else {
        nextRoom.player2Score += 1;
      }

      const targetRevealed = opponentNumber === 1 ? nextRoom.revealed1 : nextRoom.revealed2;
      const allSolved = targetRevealed.length > 0 && targetRevealed.every(Boolean);
      if (allSolved) {
        nextRoom.status = 'FINISHED';
        nextRoom.winner = session.name;
      } else {
        if (myNumber === 1) nextRoom.player1WordIndex = guessingWordIndex + 1;
        else nextRoom.player2WordIndex = guessingWordIndex + 1;
        nextRoom.currentTurn = myNumber;
        nextRoom.turnStartedAt = Date.now();
      }

      setGuess('');
      saveRoom(nextRoom);
      setToast('Correct! 🎉');
      return;
    }

    nextRoom.currentTurn = opponentNumber;
    nextRoom.turnStartedAt = Date.now();
    setGuess('');
    saveRoom(nextRoom);
    setToast('No match. Turn passed.');
  };

  const leaveGame = async () => {
    if (room && session) {
      const nextRoom: Room = { ...room };
      if (session.role === 'player1') delete nextRoom.player1;
      else delete nextRoom.player2;
      if (!nextRoom.player1 || !nextRoom.player2) {
        nextRoom.status = 'SETUP';
        nextRoom.currentTurn = null;
        nextRoom.turnStartedAt = null;
      }
      try {
        if (isFirebaseConfigured) await writeFirebaseRoom(nextRoom);
        saveRoom(nextRoom);
      } catch {
        setToast('Could not leave cleanly. Please try again.');
        return;
      }
    }
    writeSession(null);
    setSession(null);
    setRoom(null);
    setView('landing');
    router.push('/');
  };

  const renderLanding = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
          <div className="text-lg font-black tracking-[0.2em] text-cyan-300">COMPOUND WORD GUESSING</div>
          <Link href="/rules" className="text-sm font-medium text-slate-200 hover:text-cyan-300">How to Play</Link>
        </header>

        <main className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <section className="rounded-[32px] border border-cyan-400/30 bg-slate-900/80 p-8 shadow-[0_0_35px_rgba(34,211,238,0.2)]">
            <div className="mb-4 inline-flex rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">2 Players • Private Rooms • Real-Time</div>
            <h1 className="text-5xl font-black tracking-tight sm:text-6xl">COMPOUND WORD GUESSING</h1>
            <p className="mt-4 text-2xl font-semibold text-cyan-200">Build. Guess. Outsmart.</p>
            <p className="mt-6 max-w-xl text-lg text-slate-300">Challenge another player to a battle of compound words. Create your secret list, guess theirs, and be the first to solve them all.</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">Create Room</Link>
              <Link href="/join" className="rounded-full border border-white/15 bg-slate-800/70 px-6 py-3 font-semibold text-white transition hover:border-cyan-400 hover:text-cyan-300">Join Room</Link>
              <Link href="/rules" className="rounded-full border border-white/15 bg-slate-800/70 px-6 py-3 font-semibold text-white transition hover:border-cyan-400 hover:text-cyan-300">How to Play</Link>
            </div>
          </section>

          <aside className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
            <div className="text-sm uppercase tracking-[0.3em] text-slate-400">Quick rules</div>
            <ul className="mt-6 space-y-4 text-slate-200">
              <li>• Build a private list of compound words.</li>
              <li>• The opponent sees only the first letter and length.</li>
              <li>• Solve in order to keep your streak alive.</li>
              <li>• First to finish all words wins.</li>
            </ul>
          </aside>
        </main>
      </div>
    </div>
  );

  const renderRules = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
          <div className="text-lg font-black tracking-[0.2em] text-cyan-300">COMPOUND WORD GUESSING</div>
          <Link href="/" className="text-sm font-medium text-slate-200 hover:text-cyan-300">Home</Link>
        </header>

        <main className="space-y-6">
          <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-8">
            <h2 className="text-3xl font-black text-cyan-300">Compound Word Rules</h2>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-8 text-slate-200">
            <ol className="space-y-4">
              <li><strong>1.</strong> Create a private list using compound words, such as SUNFLOWER or TOOTHBRUSH.</li>
              <li><strong>2.</strong> Your opponent sees only the pattern.</li>
              <li><strong>3.</strong> Guess in turns until one player solves all words.</li>
              <li><strong>4.</strong> Correct guesses reveal the word and you keep the turn.</li>
              <li><strong>5.</strong> Wrong guesses pass the turn.</li>
              <li><strong>6.</strong> A compound word is made by joining two words to form one word.</li>
            </ol>
          </section>
        </main>
      </div>
    </div>
  );

  const renderCreate = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
          <div className="text-lg font-black tracking-[0.2em] text-cyan-300">COMPOUND WORD GUESSING</div>
          <Link href="/" className="text-sm font-medium text-slate-200 hover:text-cyan-300">Home</Link>
        </header>

        <section className="rounded-[32px] border border-white/10 bg-slate-900/70 p-8">
          <h2 className="text-3xl font-black text-cyan-300">Create Room</h2>
          <form onSubmit={createRoom} className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Enter your name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="Alex" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200" htmlFor="create-word-count">Number of words</label>
              <select id="create-word-count" value={selectedWordCount} onChange={(event) => setSelectedWordCount(Number(event.target.value))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400">
                {Array.from({ length: 16 }, (_, index) => index + 5).map((count) => (
                  <option key={count} value={count}>{count} words</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60">{isSubmitting ? 'Creating...' : 'Generate Room'}</button>
          </form>
        </section>
      </div>
    </div>
  );

  const renderJoin = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
          <div className="text-lg font-black tracking-[0.2em] text-cyan-300">COMPOUND WORD GUESSING</div>
          <Link href="/" className="text-sm font-medium text-slate-200 hover:text-cyan-300">Home</Link>
        </header>

        <section className="rounded-[32px] border border-white/10 bg-slate-900/70 p-8">
          <h2 className="text-3xl font-black text-cyan-300">Join Room</h2>
          <form onSubmit={joinRoom} className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Enter your name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="Sam" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Enter room code</label>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="K7P4QX" />
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60">{isSubmitting ? 'Joining...' : 'Join Room'}</button>
          </form>
          {toast ? <div role="alert" className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-center text-sm text-rose-200">{toast}</div> : null}
        </section>
      </div>
    </div>
  );

  const renderRoom = () => {
    if (!room || !session) {
      return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
          <div className="mx-auto max-w-2xl p-8">
            <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-8 text-center">
              <h2 className="text-3xl font-black text-cyan-300">Room not available</h2>
              <Link href="/" className="mt-5 inline-block rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950">Home</Link>
            </div>
          </div>
        </div>
      );
    }

    const player1Guesses = room.player1Guesses ?? [];
    const player2Guesses = room.player2Guesses ?? [];
    const mySubmittedWords = myNumber === 1 ? room.words1 : room.words2;
    const renderWordBoard = (playerNumber: PlayerNumber) => {
      const patterns = playerNumber === 1 ? room.wordPatterns1 : room.wordPatterns2;
      const secretWords = playerNumber === 1 ? room.words1 : room.words2;
      const revealed = playerNumber === 1 ? room.revealed1 : room.revealed2;
      const guesses = playerNumber === 1 ? player2Guesses : player1Guesses;

      return patterns.map((pattern, index) => {
        const wrongGuesses = guesses.filter((item) => item.wordIndex === index && !item.correct);
        return (
          <div key={`player-${playerNumber}-word-${index}`} className={`rounded-xl border px-3 py-2 ${revealed[index] ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-dashed border-white/15 bg-slate-950/70'}`}>
            <div className={`text-lg font-black ${revealed[index] ? 'text-emerald-300' : 'text-cyan-200'}`}>
              {revealed[index] ? `${secretWords[index] ?? pattern} ✓` : pattern}
            </div>
            {wrongGuesses.length > 0 ? <div className="mt-1 text-xs text-rose-300">Tried: {wrongGuesses.map((item) => item.word).join(', ')}</div> : null}
          </div>
        );
      });
    };

    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
            <div className="text-lg font-black tracking-[0.2em] text-cyan-300">COMPOUND WORD GUESSING</div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-white/10 bg-slate-800/80 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200">{room.roomCode}</span>
              <button type="button" onClick={leaveGame} className="rounded-full border border-white/10 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-white hover:text-cyan-300">Leave</button>
            </div>
          </header>

          <main className="space-y-6">
            <section className="grid gap-3 md:grid-cols-2">
              {[1, 2].map((playerNumber) => {
                const number = playerNumber as PlayerNumber;
                const player = number === 1 ? room.player1 : room.player2;
                const isActive = room.currentTurn === number;

                return (
                  <div key={`turn-player-${number}`} className={`rounded-2xl border px-5 py-4 ${isActive ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_24px_rgba(34,211,238,0.12)]' : 'border-white/10 bg-slate-900/70'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Player {number}</div>
                        <div className="mt-1 text-xl font-black text-white">{player?.name ?? 'Waiting'}</div>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${isActive ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                        {isActive ? 'Your turn' : room.status === 'PLAYING' ? 'Waiting' : 'Ready'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Player 1</div>
                <div className="mt-1 text-lg text-cyan-200">Score: {room.player1Score}</div>
                {room.status !== 'SETUP' ? (
                  <>
                    <div className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">Words</div>
                    <div className="mt-2 flex flex-wrap gap-2">{renderWordBoard(1)}</div>
                    <div className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">Guesses</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {player1Guesses.length ? player1Guesses.map((item, index) => (
                        <span key={`player1-guess-${index}`} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${item.correct ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                          {item.word}{item.correct ? ' ✓' : ' ✕'}
                        </span>
                      )) : <span className="text-sm text-slate-400">None yet</span>}
                    </div>
                  </>
                ) : <div className="mt-4 text-sm text-slate-400">Words appear when the game starts.</div>}
              </div>
              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Player 2</div>
                <div className="mt-1 text-lg text-cyan-200">Score: {room.player2Score}</div>
                {room.status !== 'SETUP' ? (
                  <>
                    <div className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">Words</div>
                    <div className="mt-2 flex flex-wrap gap-2">{renderWordBoard(2)}</div>
                    <div className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">Guesses</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {player2Guesses.length ? player2Guesses.map((item, index) => (
                        <span key={`player2-guess-${index}`} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${item.correct ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                          {item.word}{item.correct ? ' ✓' : ' ✕'}
                        </span>
                      )) : <span className="text-sm text-slate-400">None yet</span>}
                    </div>
                  </>
                ) : <div className="mt-4 text-sm text-slate-400">Words appear when the game starts.</div>}
              </div>
            </section>

            {room.status === 'SETUP' && (
              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
                {mySubmittedWords.length > 0 ? (
                  <div>
                    <h3 className="text-2xl font-black text-emerald-300">Your words are locked in</h3>
                    <p className="mt-2 text-slate-300">Wait for your opponent to get ready. The game will start automatically.</p>
                  </div>
                ) : (
                  <div>
                    {myNumber === 2 && !room.wordCount ? (
                      <div>
                        <h3 className="text-2xl font-black text-cyan-300">Waiting for Player 1</h3>
                        <p className="mt-2 text-slate-300">Player 1 must choose how many compound words this game will use.</p>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-2xl font-black text-cyan-300">Create Your Secret Words</h3>
                        <p className="mt-2 text-slate-300">Fill all {room.wordCount} compound words selected when this room was created.</p>
                        {((myNumber === 1 ? room.words2 : room.words1).length > 0) ? <p className="mt-2 text-emerald-300">Your opponent is ready. You are yet to fill your words.</p> : null}
                        <form onSubmit={submitWords} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {words.map((word, index) => (
                            <div key={`word-${index}`}>
                              <label className="mb-2 block text-sm font-medium text-slate-200">Word {index + 1}</label>
                              <input value={word} onChange={(event) => setWords((previous) => previous.map((value, idx) => idx === index ? event.target.value : value))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="SUNFLOWER" maxLength={15} />
                            </div>
                          ))}

                          <div className="md:col-span-2 xl:col-span-3 mt-2">
                            <button type="submit" className="rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Submit Words</button>
                          </div>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}

            {room.status === 'PLAYING' && (
              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
                <div className={`rounded-2xl border p-4 text-center ${secondsRemaining <= 5 ? 'border-rose-400/50 bg-rose-500/10' : 'border-cyan-400/20 bg-cyan-500/10'}`}>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{isMyTurn ? 'Your turn' : `${getCurrentPlayerLabel(room)}'s turn`}</div>
                  <div className={`mt-1 text-3xl font-black ${secondsRemaining <= 5 ? 'text-rose-300' : 'text-cyan-200'}`}>{secondsRemaining}s</div>
                  <div className="text-xs text-slate-400">30 seconds per turn</div>
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Opponent&apos;s words</div>
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    {myPatterns.map((pattern, index) => (
                      <div key={`pattern-${index}`} className={`rounded-xl border px-3 py-2 text-lg font-black ${myRevealed[index] ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-slate-950/80 text-cyan-200'}`}>
                        {myRevealed[index] ? `${myWords[index] ?? pattern} ✓` : pattern}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-slate-950/80 p-5 text-center">
                  <div className="text-xs uppercase tracking-[0.25em] text-cyan-300">Current target</div>
                  <div className="mt-3 text-4xl font-black tracking-[0.15em] text-white">{currentPattern || '—'}</div>
                </div>

                <form onSubmit={handleGuess} className="mt-6 space-y-4">
                  <label className="block text-sm font-semibold text-slate-200">Guess the word</label>
                  <input value={guess} onChange={(event) => setGuess(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-lg text-white outline-none focus:border-cyan-400" placeholder="APPLE" disabled={!isMyTurn} />
                  <div className="flex flex-wrap gap-3">
                    <button type="submit" disabled={!isMyTurn} className="rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">Guess</button>
                    <button type="button" onClick={leaveGame} className="rounded-full border border-white/15 bg-slate-800/70 px-5 py-3 font-semibold text-white hover:border-cyan-400 hover:text-cyan-300">Leave Game</button>
                  </div>
                </form>
              </section>
            )}

            {room.status === 'FINISHED' && (
              <section className="rounded-[28px] border border-emerald-400/30 bg-emerald-500/10 p-6 text-center">
                <h3 className="text-3xl font-black text-emerald-300">🎉 {room.winner ?? 'Player'} wins! 🎉</h3>
                <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-lg">{room.player1?.name ?? 'Player 1'} — {room.player1Score}</div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-lg">{room.player2?.name ?? 'Player 2'} — {room.player2Score}</div>
                </div>
                <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{room.player1?.name ?? 'Player 1'}&apos;s words</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {room.words1.map((word, index) => <span key={`final-word-1-${index}`} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-cyan-200">{word}</span>)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{room.player2?.name ?? 'Player 2'}&apos;s words</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {room.words2.map((word, index) => <span key={`final-word-2-${index}`} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-cyan-200">{word}</span>)}
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/create" className="rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Play Again</Link>
                  <Link href="/" className="rounded-full border border-white/15 bg-slate-800/70 px-5 py-3 font-semibold text-white hover:border-cyan-400 hover:text-cyan-300">Return Home</Link>
                </div>
              </section>
            )}
          </main>
        </div>

        {toast ? <div className="mx-auto mt-4 max-w-xl rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-center text-sm text-cyan-200">{toast}</div> : null}
      </div>
    );
  };

  if (view === 'landing') return renderLanding();
  if (view === 'rules') return renderRules();
  if (view === 'create') return renderCreate();
  if (view === 'join') return renderJoin();
  return renderRoom();
}

export { WordDuelApp };
