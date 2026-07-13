// Tiny synthesized notification sounds via WebAudio — no audio assets shipped.
// Browsers only allow audio after a user gesture; we unlock on first pointerdown.

export type SoundKind = "off" | "chime" | "pop";

let ctx: AudioContext | null = null;
let unlocked = false;

function ensureContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function installSoundUnlock(): void {
  const unlock = () => {
    const c = ensureContext();
    if (c && c.state === "suspended") void c.resume();
    unlocked = true;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gainPeak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, c.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

export function playSound(kind: SoundKind): void {
  if (kind === "off") return;
  const c = ensureContext();
  if (!c || (!unlocked && c.state === "suspended")) return;
  if (c.state === "suspended") void c.resume();

  if (kind === "chime") {
    tone(c, 880, 0, 0.35, 0.06);
    tone(c, 1318.5, 0.09, 0.4, 0.05);
  } else {
    tone(c, 420, 0, 0.12, 0.09);
    tone(c, 210, 0.02, 0.1, 0.05);
  }
}
