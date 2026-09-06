'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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

type Room = {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  player1?: Player;
  player2?: Player;
  words1: string[];
  words2: string[];
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

const normalizeWord = (value: string) => value.trim().toUpperCase();

const maskWord = (value: string) => {
  const cleaned = normalizeWord(value);
  if (!cleaned) return '';
  return `${cleaned[0]}${'-'.repeat(Math.max(0, cleaned.length - 1))}`;
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

const createRoomRecord = (roomId: string, roomCode: string, player1: Player): Room => ({
  roomId,
  roomCode,
  status: 'SETUP',
  player1,
  words1: [],
  words2: [],
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
});

const getRoomByCode = (code: string): Room | null => {
  const rooms = readRooms();
  return Object.values(rooms).find((room) => room.roomCode.toUpperCase() === code.toUpperCase()) ?? null;
};

const getOpponentNumber = (playerNumber: PlayerNumber): PlayerNumber => (playerNumber === 1 ? 2 : 1);

const getOpponentWordList = (room: Room, playerNumber: PlayerNumber) =>
  playerNumber === 1 ? room.words2 : room.words1;

const isValidWordList = (words: string[]) => {
  const cleaned = words
    .map((word) => normalizeWord(word))
    .filter(Boolean)
    .filter((word) => /^[A-Z]+$/.test(word) && word.length >= 3 && word.length <= 15);

  return cleaned.length >= 3 && cleaned.length <= 10 ? cleaned : null;
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
  const [words, setWords] = useState<string[]>(['', '', '', '', '']);
  const [guess, setGuess] = useState('');
  const [toast, setToast] = useState<string | null>(null);

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
  const isMyTurn = Boolean(room && myNumber && room.currentTurn === myNumber);
  const currentWordIndex = room && myNumber
    ? (myNumber === 1 ? room.player1WordIndex : room.player2WordIndex)
    : 0;
  const currentPattern = room && myNumber
    ? (myNumber === 1 ? room.wordPatterns2[currentWordIndex] : room.wordPatterns1[currentWordIndex])
    : '';

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

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setToast('Name must be at least 2 characters.');
      return;
    }

    const firebaseUser = isFirebaseConfigured ? await ensureAnonymousUser() : null;
    const roomId = `room-${Date.now()}`;
    const roomCodeValue = generateRoomCode();
    const player1: Player = { uid: firebaseUser?.uid ?? `uid-${Date.now()}`, name: trimmedName, playerNumber: 1 };
    const nextRoom = createRoomRecord(roomId, roomCodeValue, player1);
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
  };

  const joinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
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

      const player2: Player = { uid: firebaseUser?.uid ?? `uid-${Date.now()}`, name: trimmedName, playerNumber: 2 };
      const nextRoom: Room = {
        ...found,
        player2,
        status: 'SETUP',
        currentTurn: null,
        currentWordIndex: 0,
        player1WordIndex: 0,
        player2WordIndex: 0,
      };
      const nextSession: Session = { roomId: nextRoom.roomId, uid: player2.uid, name: trimmedName, role: 'player2' };

      await writeFirebaseRoom(nextRoom);
      saveRoom(nextRoom);
      writeSession(nextSession);
      setSession(nextSession);
      setView('room');
      router.push(`/room/${code}`);
      setToast('Joined room');
    } catch {
      setToast('Unable to join. Enable Anonymous Auth and publish Firestore rules.');
    }
  };

  const submitWords = (event: React.FormEvent) => {
    event.preventDefault();
    if (!room || !session) return;

    const cleaned = isValidWordList(words);
    if (!cleaned) {
      setToast('Enter 3–10 alphabetic words between 3 and 15 letters.');
      return;
    }

    const playerNumber = session.role === 'player1' ? 1 : 2;
    const nextRoom: Room = { ...room };

    if (playerNumber === 1) {
      nextRoom.words1 = cleaned;
      nextRoom.wordPatterns1 = cleaned.map((word) => maskWord(word));
      nextRoom.revealed1 = Array(cleaned.length).fill(false);
    } else {
      nextRoom.words2 = cleaned;
      nextRoom.wordPatterns2 = cleaned.map((word) => maskWord(word));
      nextRoom.revealed2 = Array(cleaned.length).fill(false);
    }

    if (nextRoom.player1 && nextRoom.player2) {
      const bothReady = nextRoom.words1.length > 0 && nextRoom.words2.length > 0;
      nextRoom.status = bothReady ? 'PLAYING' : 'SETUP';
      if (bothReady) {
        nextRoom.currentTurn = Math.random() > 0.5 ? 1 : 2;
      }
    }

    saveRoom(nextRoom);
    setWords(['', '', '', '', '']);
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

    const normalizedGuess = normalizeWord(guess);
    if (!/^[A-Z]+$/.test(normalizedGuess) || normalizedGuess.length < 3) {
      setToast('Guess must be at least 3 letters.');
      return;
    }

    const opponentNumber = getOpponentNumber(myNumber);
    const guessingWordIndex = myNumber === 1
      ? (room.player1WordIndex ?? room.currentWordIndex)
      : (room.player2WordIndex ?? room.currentWordIndex);
    const opponentWords = getOpponentWordList(room, myNumber);
    const secretWord = opponentWords[guessingWordIndex] ?? '';
    const nextRoom: Room = { ...room };

    if (normalizedGuess === normalizeWord(secretWord)) {
      if (opponentNumber === 1) {
        nextRoom.revealed1[guessingWordIndex] = true;
      } else {
        nextRoom.revealed2[guessingWordIndex] = true;
      }

      if (myNumber === 1) nextRoom.player1Score += 1;
      else nextRoom.player2Score += 1;

      const targetRevealed = opponentNumber === 1 ? nextRoom.revealed1 : nextRoom.revealed2;
      const allSolved = targetRevealed.length > 0 && targetRevealed.every(Boolean);
      if (allSolved) {
        nextRoom.status = 'FINISHED';
        nextRoom.winner = session.name;
      } else {
        if (myNumber === 1) nextRoom.player1WordIndex = guessingWordIndex + 1;
        else nextRoom.player2WordIndex = guessingWordIndex + 1;
        nextRoom.currentTurn = myNumber;
      }

      setGuess('');
      saveRoom(nextRoom);
      setToast('Correct! 🎉');
      return;
    }

    nextRoom.currentTurn = opponentNumber;
    setGuess('');
    saveRoom(nextRoom);
    setToast('No match. Turn passed.');
  };

  const leaveGame = () => {
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
          <div className="text-lg font-black tracking-[0.35em] text-cyan-300">WORD DUEL</div>
          <Link href="/rules" className="text-sm font-medium text-slate-200 hover:text-cyan-300">How to Play</Link>
        </header>

        <main className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <section className="rounded-[32px] border border-cyan-400/30 bg-slate-900/80 p-8 shadow-[0_0_35px_rgba(34,211,238,0.2)]">
            <div className="mb-4 inline-flex rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">2 Players • Private Rooms • Real-Time</div>
            <h1 className="text-5xl font-black tracking-tight sm:text-6xl">WORD DUEL</h1>
            <p className="mt-4 text-2xl font-semibold text-cyan-200">Create. Guess. Outsmart.</p>
            <p className="mt-6 max-w-xl text-lg text-slate-300">Challenge another player to a battle of words. Create your secret list, guess theirs, and be the first to solve them all.</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">Create Room</Link>
              <Link href="/join" className="rounded-full border border-white/15 bg-slate-800/70 px-6 py-3 font-semibold text-white transition hover:border-cyan-400 hover:text-cyan-300">Join Room</Link>
              <Link href="/rules" className="rounded-full border border-white/15 bg-slate-800/70 px-6 py-3 font-semibold text-white transition hover:border-cyan-400 hover:text-cyan-300">How to Play</Link>
            </div>
          </section>

          <aside className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
            <div className="text-sm uppercase tracking-[0.3em] text-slate-400">Quick rules</div>
            <ul className="mt-6 space-y-4 text-slate-200">
              <li>• Build a private word list.</li>
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
          <div className="text-lg font-black tracking-[0.35em] text-cyan-300">WORD DUEL</div>
          <Link href="/" className="text-sm font-medium text-slate-200 hover:text-cyan-300">Home</Link>
        </header>

        <main className="space-y-6">
          <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-8">
            <h2 className="text-3xl font-black text-cyan-300">Rulebook</h2>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-8 text-slate-200">
            <ol className="space-y-4">
              <li><strong>1.</strong> Create a private word list.</li>
              <li><strong>2.</strong> Your opponent sees only the pattern.</li>
              <li><strong>3.</strong> Guess in turns until one player solves all words.</li>
              <li><strong>4.</strong> Correct guesses reveal the word and you keep the turn.</li>
              <li><strong>5.</strong> Wrong guesses pass the turn.</li>
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
          <div className="text-lg font-black tracking-[0.35em] text-cyan-300">WORD DUEL</div>
          <Link href="/" className="text-sm font-medium text-slate-200 hover:text-cyan-300">Home</Link>
        </header>

        <section className="rounded-[32px] border border-white/10 bg-slate-900/70 p-8">
          <h2 className="text-3xl font-black text-cyan-300">Create Room</h2>
          <form onSubmit={createRoom} className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Enter your name</label>
              <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="Alex" />
            </div>
            <button type="submit" className="w-full rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Generate Room</button>
          </form>
        </section>
      </div>
    </div>
  );

  const renderJoin = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
          <div className="text-lg font-black tracking-[0.35em] text-cyan-300">WORD DUEL</div>
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
            <button type="submit" className="w-full rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Join Room</button>
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

    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#14233f,_#0a0d18_58%,_#05070d)] text-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/60 px-4 py-3 backdrop-blur-sm">
            <div className="text-lg font-black tracking-[0.35em] text-cyan-300">WORD DUEL</div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-white/10 bg-slate-800/80 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200">{room.roomCode}</span>
              <button type="button" onClick={leaveGame} className="rounded-full border border-white/10 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-white hover:text-cyan-300">Leave</button>
            </div>
          </header>

          <main className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2">
              <div className={`rounded-[28px] border p-5 ${room.currentTurn === 1 ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-slate-900/70'}`}>
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Player 1</div>
                <div className="mt-2 text-2xl font-black">{room.player1?.name ?? 'Waiting'}</div>
                <div className="mt-1 text-lg text-cyan-200">Score: {room.player1Score}</div>
              </div>
              <div className={`rounded-[28px] border p-5 ${room.currentTurn === 2 ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-slate-900/70'}`}>
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Player 2</div>
                <div className="mt-2 text-2xl font-black">{room.player2?.name ?? 'Waiting'}</div>
                <div className="mt-1 text-lg text-cyan-200">Score: {room.player2Score}</div>
              </div>
            </section>

            {room.status === 'SETUP' && (
              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
                <h3 className="text-2xl font-black text-cyan-300">Create Your Secret Words</h3>
                <form onSubmit={submitWords} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {words.map((word, index) => (
                    <div key={`word-${index}`}>
                      <label className="mb-2 block text-sm font-medium text-slate-200">Word {index + 1}</label>
                      <input value={word} onChange={(event) => setWords((previous) => previous.map((value, idx) => idx === index ? event.target.value : value))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="APPLE" maxLength={15} />
                    </div>
                  ))}

                  <div className="md:col-span-2 xl:col-span-3 mt-2 flex flex-wrap gap-3">
                    <button type="submit" className="rounded-full bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300">Submit Words</button>
                    <button type="button" onClick={() => setWords((previous) => [...previous, ''])} className="rounded-full border border-white/15 bg-slate-800/70 px-5 py-3 font-semibold text-white hover:border-cyan-400 hover:text-cyan-300">Add Word</button>
                  </div>
                </form>
              </section>
            )}

            {room.status === 'PLAYING' && (
              <section className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6">
                <div className="text-center">
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Opponent&apos;s words</div>
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    {myPatterns.map((pattern, index) => (
                      <div key={`pattern-${index}`} className={`rounded-xl border px-3 py-2 text-lg font-black ${myRevealed[index] ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-slate-950/80 text-cyan-200'}`}>
                        {myRevealed[index] ? pattern.replace(/-/g, '').toUpperCase() + ' ✓' : pattern}
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