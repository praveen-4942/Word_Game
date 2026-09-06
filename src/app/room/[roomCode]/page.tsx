import { WordDuelApp } from '@/components/WordDuelApp';

export default async function RoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  return <WordDuelApp initialView="room" roomCode={roomCode} />;
}
