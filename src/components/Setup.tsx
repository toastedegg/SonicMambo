import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { MicCheck } from './MicCheck';
import { Tuner } from './Tuner';
import {
  SignalChainDiagram,
  GuitarIcon,
  CableIcon,
  InterfaceIcon,
  UsbIcon,
  ComputerIcon,
  MicIcon,
  AmpIcon,
  AppIcon,
} from './SignalChainDiagram';

type InputProfile = 'interface' | 'laptop-mic' | 'micd-amp';

const INPUT_PROFILE_KEY = 'sonicmambo:inputProfile';

interface SetupProps {
  /** Fires once each time the user scrolls the main column so the page bottom enters view (CTA pulse in footer). */
  onReachedScrollEnd?: () => void;
  /** Mirrors `useAudioEngine` capture state for the global top bar (Mic On / Mic Off). */
  onMicListeningChange?: (listening: boolean) => void;
}

export function Setup({ onReachedScrollEnd, onMicListeningChange }: SetupProps) {
  const {
    isListening,
    loudness,
    currentNote,
    frequency,
    smoothedFrequency,
    error,
    start,
    stop,
  } = useAudioEngine();

  const [profile, setProfile] = useState<InputProfile | null>(() => {
    try {
      const raw = window.localStorage.getItem(INPUT_PROFILE_KEY);
      return raw === 'interface' || raw === 'laptop-mic' || raw === 'micd-amp'
        ? (raw as InputProfile)
        : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    return () => stop();
  }, [stop]);

  useEffect(() => {
    onMicListeningChange?.(isListening);
  }, [isListening, onMicListeningChange]);

  const scrollEndSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = scrollEndSentinelRef.current;
    if (!sentinel || !onReachedScrollEnd) return;

    const root = sentinel.closest('main');
    let wasIntersecting = false;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0]?.isIntersecting ?? false;
        if (hit && !wasIntersecting) {
          onReachedScrollEnd();
        }
        wasIntersecting = hit;
      },
      { root: root ?? undefined, rootMargin: '0px 0px -12px 0px', threshold: 0.72 },
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, [onReachedScrollEnd]);

  const handleProfileSelect = useCallback((p: InputProfile) => {
    setProfile(p);
    try {
      window.localStorage.setItem(INPUT_PROFILE_KEY, p);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-10">
        <span className="sp-section-label">Welcome</span>
        <h1 className="sp-heading-lg mt-1 mb-3">Let&rsquo;s get your guitar ready</h1>
        <p className="text-sp-text-sub max-w-2xl">
          SonicMambo listens to your guitar through your computer&rsquo;s microphone input and
          detects the notes you play in real time. Spend two minutes here and the lessons
          will feel right the first time you try one.
        </p>
      </header>

      <StepHeader number={1} title="Choose how you&rsquo;re connecting" />
      <p className="text-sm text-sp-text-sub mb-4 max-w-2xl">
        Tap the option that matches your setup. This doesn&rsquo;t change any behavior &mdash;
        it just helps you follow the rest of the guide.
      </p>
      <div className="grid gap-3 md:grid-cols-2 mb-10">
        <SignalChainDiagram
          title="Electric guitar via audio interface"
          description="Best for electric guitar. Uses the instrument input of a Focusrite Scarlett, Apogee, Universal Audio, or similar USB interface."
          badge="Recommended"
          highlighted={profile === 'interface'}
          onClick={() => handleProfileSelect('interface')}
          steps={[
            { label: 'Electric guitar', icon: <GuitarIcon /> },
            { label: '1/4" cable', icon: <CableIcon /> },
            { label: 'Audio interface', sub: 'Focusrite, etc.', icon: <InterfaceIcon /> },
            { label: 'USB', icon: <UsbIcon /> },
            { label: 'Computer', icon: <ComputerIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
        <SignalChainDiagram
          title="Acoustic guitar via laptop mic"
          description="Zero gear needed. Works fine for practice if your room is quiet. Sit close to the laptop."
          highlighted={profile === 'laptop-mic'}
          onClick={() => handleProfileSelect('laptop-mic')}
          steps={[
            { label: 'Acoustic guitar', icon: <GuitarIcon /> },
            { label: 'Laptop mic', icon: <MicIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
        <SignalChainDiagram
          title="Mic'd amp"
          description="Electric guitar through an amp with a microphone in front of the speaker, into an audio interface."
          highlighted={profile === 'micd-amp'}
          onClick={() => handleProfileSelect('micd-amp')}
          steps={[
            { label: 'Electric guitar', icon: <GuitarIcon /> },
            { label: 'Amp', icon: <AmpIcon /> },
            { label: 'Mic', icon: <MicIcon /> },
            { label: 'Interface', icon: <InterfaceIcon /> },
            { label: 'Computer', icon: <ComputerIcon /> },
            { label: 'SonicMambo', icon: <AppIcon /> },
          ]}
        />
      </div>

      {profile === 'interface' && <FocusriteTips />}
      {profile === 'laptop-mic' && <LaptopMicTips />}
      {profile === 'micd-amp' && <MicdAmpTips />}

      <StepHeader number={2} title="Turn on the mic" />
      <p className="text-sm text-sp-text-sub mb-4 max-w-2xl">
        SonicMambo needs microphone access from your browser. Click below, then accept the
        prompt. If nothing happens, look for the blocked-mic icon next to the URL bar.
      </p>
      <div className="mb-10">
        {!isListening ? (
          <button
            type="button"
            onClick={() => start()}
            className="sp-btn-primary-compact max-w-xs"
          >
            Turn on mic
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sp-green/15 text-sp-green font-bold text-sm">
              <span className="sp-mic-dot sp-mic-dot-on" />
              Mic is on
            </span>
            <button
              type="button"
              onClick={stop}
              className="sp-btn-secondary"
            >
              Turn off
            </button>
          </div>
        )}
        {error && (
          <p className="text-sm text-brand-red mt-3 max-w-2xl">
            <strong>Couldn&rsquo;t start the mic:</strong> {error}
          </p>
        )}
      </div>

      <StepHeader number={3} title="Pick the right input device" />
      <div className="sp-card-padded mb-10">
        <p className="text-sm text-sp-text-sub mb-3">
          SonicMambo uses your operating system&rsquo;s default input device. If your
          interface isn&rsquo;t being used, change the default in your OS and/or the
          browser:
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <DeviceInstructions
            title="macOS"
            steps={[
              'System Settings \u2192 Sound \u2192 Input',
              'Pick your Focusrite / audio interface',
              'Reload this page',
            ]}
          />
          <DeviceInstructions
            title="Windows"
            steps={[
              'Settings \u2192 System \u2192 Sound \u2192 Input',
              'Choose your interface as the input device',
              'Reload this page',
            ]}
          />
          <DeviceInstructions
            title="Chrome"
            steps={[
              'Settings → Privacy and security → Site settings → Microphone',
              'Choose your interface as the microphone input',
              'Reload this page',
            ]}
          />
        </div>
        <p className="text-xs text-sp-text-muted mt-4">
          After changing the device, turn the mic off and on again using the button above.
        </p>
      </div>

      <StepHeader number={4} title="Check your signal" />
      <div className="mb-10">
        <MicCheck
          isListening={isListening}
          loudness={loudness}
          currentNote={currentNote}
          frequency={frequency}
          error={error}
        />
      </div>

      <StepHeader number={5} title="Tune up" />
      <div className="mb-10">
        <Tuner isListening={isListening} smoothedFrequency={smoothedFrequency} />
      </div>

      <StepHeader number={6} title="Tips for clean detection" />
      <div className="sp-card-padded mb-10">
        <ul className="space-y-2 text-sm text-sp-text-sub">
          <li className="flex gap-2">
            <Bullet /> Use a clean tone. Distortion, fuzz, and heavy reverb confuse pitch
            detection &mdash; turn off pedals and amp sims while practicing with SonicMambo.
          </li>
          <li className="flex gap-2">
            <Bullet /> Keep the input level in the green zone on the signal meter. Too
            quiet and nothing is detected; too hot and the signal clips.
          </li>
          <li className="flex gap-2">
            <Bullet /> Pluck one note at a time. Chords and double-stops don&rsquo;t work
            yet &mdash; SonicMambo detects a single fundamental pitch.
          </li>
          <li className="flex gap-2">
            <Bullet /> Tune first. A string that&rsquo;s 30 cents flat gets labeled as the
            wrong note, and lessons will feel unfair.
          </li>
          <li className="flex gap-2">
            <Bullet /> Play in a quiet room. Fan noise and chatter can cause false
            detections, especially with an acoustic guitar into a laptop mic.
          </li>
        </ul>
      </div>

      <div
        ref={scrollEndSentinelRef}
        className="h-2 w-full shrink-0"
        aria-hidden
      />
    </div>
  );
}

function StepHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3 mt-8">
      <span className="w-8 h-8 rounded-full bg-sp-green/15 text-sp-green font-extrabold flex items-center justify-center text-sm shrink-0">
        {number}
      </span>
      <h2 className="sp-heading-md" dangerouslySetInnerHTML={{ __html: title }} />
    </div>
  );
}

function Bullet() {
  return (
    <span className="text-sp-green shrink-0 mt-0.5">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="8" cy="8" r="3" />
      </svg>
    </span>
  );
}

function DeviceInstructions({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-white mb-2">{title}</h4>
      <ol className="text-xs text-sp-text-sub space-y-1 list-decimal list-inside">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function FocusriteTips() {
  return (
    <div className="sp-card-padded mb-10 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for your audio interface</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>
          Plug the guitar cable into the <strong>instrument</strong> (Inst / Hi-Z) input,
          not the Line input. On a Focusrite Scarlett the input has an <strong>INST</strong> switch
          you need to engage.
        </li>
        <li>
          Set input gain so the halo ring is amber on hard strums but never flashing red.
          A good starting point is about 50%.
        </li>
        <li>
          Turn off monitoring / direct monitor unless you have headphones connected,
          otherwise you&rsquo;ll get feedback through your laptop speakers.
        </li>
      </ul>
    </div>
  );
}

function LaptopMicTips() {
  return (
    <div className="sp-card-padded mb-10 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for the laptop mic</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>Sit 30&ndash;60 cm (1&ndash;2 ft) from the laptop with the sound hole roughly aimed at it.</li>
        <li>Close fans, YouTube, other noise sources. Pitch detection hates background hum.</li>
        <li>
          If notes come through as the wrong letter, try lowering the laptop&rsquo;s input
          gain in the OS sound settings.
        </li>
      </ul>
    </div>
  );
}

function MicdAmpTips() {
  return (
    <div className="sp-card-padded mb-10 border border-sp-green/20">
      <h4 className="font-bold text-white mb-2">Tips for mic&rsquo;d amp</h4>
      <ul className="text-sm text-sp-text-sub space-y-1.5">
        <li>Use the amp&rsquo;s <strong>clean</strong> channel. Overdrive adds overtones that trip up pitch detection.</li>
        <li>Point the mic at the speaker cone about 5&ndash;10 cm away, slightly off-axis.</li>
        <li>Engage your interface&rsquo;s pad or lower the mic gain if the signal is hot.</li>
      </ul>
    </div>
  );
}
