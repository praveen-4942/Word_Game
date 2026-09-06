import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1b2a52,_#0a0f1b_48%,_#05070d)] text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

export function TopBar({ title }: { title: string }) {
  return (
    <header className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 shadow-[0_0_25px_rgba(96,165,250,0.2)] backdrop-blur">
      <Link href="/" className="text-lg font-black tracking-[0.25em] text-cyan-300">
        WORD DUEL
      </Link>
      <div className="text-sm font-medium text-slate-200">{title}</div>
    </header>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-xl ${className}`}>{children}</div>;
}

export function PrimaryButton({ children, onClick, type = 'button', href, disabled = false }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; href?: string; disabled?: boolean }) {
  const classes = 'inline-flex items-center justify-center rounded-full bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50';

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, type = 'button', href }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; href?: string }) {
  const classes = 'inline-flex items-center justify-center rounded-full border border-white/15 bg-slate-800/70 px-5 py-3 font-semibold text-white transition hover:border-cyan-400 hover:text-cyan-300';

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} onClick={onClick}>
      {children}
    </button>
  );
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' | 'warning' }) {
  const tones = {
    neutral: 'border-white/10 bg-slate-800/80 text-slate-200',
    success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
    danger: 'border-red-400/30 bg-red-500/10 text-red-300',
    warning: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  };

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{label}</span>;
}
