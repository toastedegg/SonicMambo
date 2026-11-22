import React from 'react';

export type MamboMood = 'groove' | 'hype' | 'celebrate' | 'chill';

interface MamboMascotSvgProps {
  mood?: MamboMood;
  size?: number;
  className?: string;
}

const MOOD_COLORS: Record<
  MamboMood,
  { body: string; cheek: string; bolt: string; accent: string }
> = {
  groove: {
    body: '#D8FF2E',
    cheek: '#FF3B7F',
    bolt: '#FF8A00',
    accent: '#2B59FF',
  },
  hype: {
    body: '#FF8A00',
    cheek: '#FF3B7F',
    bolt: '#D8FF2E',
    accent: '#2B59FF',
  },
  celebrate: {
    body: '#D8FF2E',
    cheek: '#FF8A00',
    bolt: '#FF3B7F',
    accent: '#2B59FF',
  },
  chill: {
    body: '#1CE088',
    cheek: '#FF8A00',
    bolt: '#D8FF2E',
    accent: '#2B59FF',
  },
};

/**
 * Mambo Pick / Amp Buddy — bespoke inline SVG mascot combining a retro mini guitar amp
 * with a guitar pick silhouette, lightning antenna, and expressive comic eyes.
 */
export function MamboMascotSvg({
  mood = 'groove',
  size = 86,
  className = '',
}: MamboMascotSvgProps) {
  const palette = MOOD_COLORS[mood];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 124"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Mambo Amp Buddy Mascot"
    >
      {/* Offset hard shadow under feet */}
      <ellipse cx="62" cy="116" rx="34" ry="5.5" fill="#121212" opacity="0.22" />

      {/* Celebratory floating music notes / sparkles */}
      {mood === 'celebrate' ? (
        <>
          <path
            d="M14 26L18 16L22 26L31 28L22 31L18 41L14 31L5 28L14 26Z"
            fill="#FF3B7F"
            stroke="#121212"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M101 18L104 10L107 18L115 20L107 23L104 31L101 23L93 20L101 18Z"
            fill="#2B59FF"
            stroke="#121212"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          {/* Eighth note floating right */}
          <g transform="translate(94, 16) rotate(12)">
            <path
              d="M6 16V3L16 0V13"
              stroke="#121212"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="3.5" cy="16.5" r="3.5" fill="#FF3B7F" stroke="#121212" strokeWidth="2.2" />
            <circle cx="13.5" cy="13.5" r="3.5" fill="#2B59FF" stroke="#121212" strokeWidth="2.2" />
          </g>
        </>
      )}

      {/* Lightning Antenna */}
      <path
        d="M60 32L53 19H62L58 6L71 19H62L66 32"
        fill={palette.bolt}
        stroke="#121212"
        strokeWidth="2.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Little Amp Side Handles / Ears */}
      <rect
        x="12"
        y="55"
        width="10"
        height="18"
        rx="5"
        fill="#2B59FF"
        stroke="#121212"
        strokeWidth="2.8"
      />
      <rect
        x="98"
        y="55"
        width="10"
        height="18"
        rx="5"
        fill="#2B59FF"
        stroke="#121212"
        strokeWidth="2.8"
      />

      {/* Stubby Boots */}
      <rect
        x="36"
        y="102"
        width="16"
        height="12"
        rx="5"
        fill="#121212"
      />
      <rect
        x="68"
        y="102"
        width="16"
        height="12"
        rx="5"
        fill="#121212"
      />

      {/* Main Amp-Pick Body (hard brutal shadow behind) */}
      <path
        d="M25 46C25 36.5 32.5 30 42 30H82C91.5 30 99 36.5 99 46L95 87C94 97.5 85 106 72 108L62 110L52 108C39 106 30 97.5 29 87L25 46Z"
        fill="#121212"
      />

      {/* Main Amp-Pick Body */}
      <path
        d="M21 43C21 33.5 28.5 27 38 27H82C91.5 27 99 33.5 99 43L95 84C94 94.5 85 103 72 105L60 107L48 105C35 103 26 94.5 25 84L21 43Z"
        fill={palette.body}
        stroke="#121212"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Top Amp Control Plate Strip */}
      <path
        d="M24 42C24 34 30 29 38 29H82C90 29 96 34 96 42V47H24V42Z"
        fill="#121212"
      />

      {/* 3 Mini Amp Knobs + Glowing Power Jewel */}
      <circle cx="38" cy="38" r="4" fill="#FFFBF0" />
      <line x1="38" y1="38" x2="39.5" y2="35" stroke="#121212" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="51" cy="38" r="4" fill="#FFFBF0" />
      <line x1="51" y1="38" x2="53.5" y2="37" stroke="#121212" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="64" cy="38" r="4" fill="#FFFBF0" />
      <line x1="64" y1="38" x2="62.5" y2="35.5" stroke="#121212" strokeWidth="1.6" strokeLinecap="round" />
      {/* Power Jewel */}
      <circle cx="82" cy="38" r="3.6" fill="#FF3B7F" stroke="#FFFBF0" strokeWidth="1.4" />

      {/* Speaker Grill Inner Bezel */}
      <rect
        x="30"
        y="53"
        width="60"
        height="44"
        rx="14"
        fill="#FFFBF0"
        stroke="#121212"
        strokeWidth="2.8"
      />

      {/* Subtle speaker dot pattern along bottom edges */}
      <circle cx="37" cy="89" r="1.5" fill="#121212" opacity="0.25" />
      <circle cx="43" cy="91" r="1.5" fill="#121212" opacity="0.25" />
      <circle cx="77" cy="91" r="1.5" fill="#121212" opacity="0.25" />
      <circle cx="83" cy="89" r="1.5" fill="#121212" opacity="0.25" />

      {/* Expressive Eyes */}
      {mood === 'celebrate' ? (
        <>
          {/* Star/happy arched eyes */}
          <path
            d="M40 70C42 63 50 63 52 70"
            stroke="#121212"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M68 70C70 63 78 63 80 70"
            stroke="#121212"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          {/* Oversized comic eyes */}
          <ellipse cx="46" cy="68" rx="6.2" ry="7.4" fill="#121212" />
          <circle cx="48.2" cy="65.2" r="2.3" fill="#FFFFFF" />
          <circle cx="44" cy="71" r="1.1" fill="#FFFFFF" />

          <ellipse cx="74" cy="68" rx="6.2" ry="7.4" fill="#121212" />
          <circle cx="76.2" cy="65.2" r="2.3" fill="#FFFFFF" />
          <circle cx="72" cy="71" r="1.1" fill="#FFFFFF" />
        </>
      )}

      {/* Rosy Risograph Cheeks */}
      <ellipse cx="37" cy="76" rx="4.5" ry="2.6" fill={palette.cheek} opacity="0.85" />
      <ellipse cx="83" cy="76" rx="4.5" ry="2.6" fill={palette.cheek} opacity="0.85" />

      {/* Expressive Mouth */}
      {mood === 'hype' || mood === 'celebrate' ? (
        <>
          <path
            d="M50 78C50 78 55 90 60 90C65 90 70 78 70 78H50Z"
            fill="#121212"
            stroke="#121212"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M55 86C57 84 63 84 65 86C63 88.5 57 88.5 55 86Z"
            fill="#FF3B7F"
          />
        </>
      ) : (
        <path
          d="M51 79C54 85 66 85 69 79"
          stroke="#121212"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

interface MamboCoachCardProps {
  mood?: MamboMood;
  badgeText?: string;
  quote: string;
  subline?: string;
  compact?: boolean;
  action?: React.ReactNode;
  className?: string;
}

export function MamboCoachCard({
  mood = 'groove',
  badgeText = 'MAMBO COACH',
  quote,
  subline,
  compact = false,
  action,
  className = '',
}: MamboCoachCardProps) {
  return (
    <div
      className={`neo-card bg-[#FFF4D8] ${
        compact ? 'p-3.5' : 'p-4'
      } flex items-center gap-3.5 relative overflow-visible ${className}`}
    >
      <div className="shrink-0">
        <MamboMascotSvg mood={mood} size={compact ? 70 : 82} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D8FF2E]" />
            {badgeText}
          </span>
        </div>

        {/* Speech Bubble */}
        <div className="relative bg-white border-2 border-[#121212] rounded-xl px-3 py-2 shadow-brutal-xs">
          {/* Comic bubble pointer */}
          <span
            aria-hidden
            className="absolute -left-[8px] top-3 w-3 h-3 bg-white border-l-2 border-b-2 border-[#121212] rotate-45"
          />
          <p
            className={`font-display font-extrabold text-[#121212] leading-snug ${
              compact ? 'text-[13px]' : 'text-sm'
            }`}
          >
            &ldquo;{quote}&rdquo;
          </p>
          {subline && (
            <p className="font-mono text-[10px] font-bold text-[#57534A] mt-1">
              {subline}
            </p>
          )}
        </div>

        {action && <div className="pt-0.5">{action}</div>}
      </div>
    </div>
  );
}
