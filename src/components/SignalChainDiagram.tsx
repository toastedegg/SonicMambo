import type { ReactNode } from 'react';

export interface SignalChainStep {
  label: string;
  sub?: string;
  icon?: ReactNode;
}

interface SignalChainDiagramProps {
  title: string;
  description?: string;
  steps: SignalChainStep[];
  highlighted?: boolean;
  onClick?: () => void;
  badge?: string;
}

export function SignalChainDiagram({
  title,
  description,
  steps,
  highlighted = false,
  onClick,
  badge,
}: SignalChainDiagramProps) {
  const Wrapper = onClick ? 'button' : 'div';
  const interactiveClass = onClick
    ? 'sp-card-interactive cursor-pointer text-left'
    : 'sp-card';
  const borderClass = highlighted
    ? 'border border-sp-green ring-2 ring-sp-green/30'
    : 'border border-white/5';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`block w-full p-5 rounded-lg ${interactiveClass} ${borderClass}`}
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="font-bold text-white text-base">{title}</h3>
        {badge && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-sp-green bg-sp-green/15 px-2 py-1 rounded-full">
            {badge}
          </span>
        )}
      </div>
      {description && (
        <p className="text-sm text-sp-text-sub mb-4">{description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <StepBox step={step} />
            {i < steps.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
    </Wrapper>
  );
}

function StepBox({ step }: { step: SignalChainStep }) {
  return (
    <div className="flex flex-col items-center min-w-[80px] px-3 py-2 rounded-md bg-sp-elevated border border-white/5">
      {step.icon && <div className="mb-1 text-sp-text-sub">{step.icon}</div>}
      <span className="text-xs font-bold text-white text-center leading-tight">
        {step.label}
      </span>
      {step.sub && (
        <span className="text-[10px] text-sp-text-muted mt-0.5 text-center">
          {step.sub}
        </span>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <svg
      width="20"
      height="12"
      viewBox="0 0 20 12"
      fill="none"
      className="text-sp-text-muted shrink-0"
      aria-hidden
    >
      <path
        d="M1 6h16m0 0l-4-4m4 4l-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const GuitarIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M14 3l7 7-3 3-7-7 3-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="8" cy="16" r="4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M11 13l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const CableIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M4 20c4 0 4-6 8-6s4 6 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" />
    <circle cx="20" cy="20" r="1.5" fill="currentColor" />
  </svg>
);

export const InterfaceIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="8" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="14" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="18" cy="12" r="0.8" fill="currentColor" />
  </svg>
);

export const UsbIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 3v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="12" cy="20" r="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 3l-3 4h6l-3-4z" fill="currentColor" />
    <path d="M8 10l-2 3 2 2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 10l2 3-2 2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ComputerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 20h8M10 16v4m4-4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const MicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const AmpIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="9" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="16" cy="8" r="1" fill="currentColor" />
    <circle cx="18" cy="8" r="1" fill="currentColor" />
    <path d="M14 14h4M14 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const AppIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
