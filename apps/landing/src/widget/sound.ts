/* Gentle Web Audio API chime for incoming AI / manager replies. */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export function playChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const notes: Array<{ freq: number; start: number; duration: number }> = [
      { freq: 587.33, start: 0, duration: 0.09 },
      { freq: 880, start: 0.08, duration: 0.1 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.07, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.01);
    }
  } catch {
    // Ignore audio errors (autoplay policy, restricted environments)
  }
}
