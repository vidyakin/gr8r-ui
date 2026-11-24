/* Мягкий звук уведомления о новом входящем сообщении в модуле «Чаты» (Web Audio API, без внешних файлов). */

const STORAGE_KEY = 'erp_chats_sound_muted';
let audioCtx: AudioContext | null = null;

export function isChatSoundMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChatSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

/** Воспроизводит короткий мягкий двухтоновый звук (587 Гц → 880 Гц, ~180 мс) */
export function playChatNotificationSound(): void {
  if (isChatSoundMuted()) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.01);
    };

    playTone(587.33, now, 0.09);
    playTone(880, now + 0.075, 0.12);
  } catch {
    // ignore autoplay / Web Audio restrictions
  }
}
