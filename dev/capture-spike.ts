/**
 * Dev-only spike for U1 of the export-with-video plan (not shipped, not a test: it needs a person at the capture picker).
 * Serve with `npm run dev` and open `/dev/capture-spike.html`. It checks that this browser can capture the page with
 * its audio, that the YouTube player's picture is in the recording, and what container the recorder produces.
 */
import { mountPlayer, type EmbeddedPlayer } from '../src/app/youtube-player';

const logEl = document.getElementById('log')!;
const lines: string[] = [];
const note = (line: string) => {
  lines.push(line);
  logEl.textContent = lines.join('\n');
};

const vidInput = document.getElementById('vid') as HTMLInputElement;
const secsInput = document.getElementById('secs') as HTMLInputElement;
const out = document.getElementById('out') as HTMLVideoElement;
const host = document.getElementById('player')!;
let player: EmbeddedPlayer | null = null;

/** Accepts a bare 11-character id or any youtube link that carries one. */
function videoIdFrom(text: string): string | null {
  const m = text.trim().match(/(?:v=|youtu\.be\/|embed\/|^)([A-Za-z0-9_-]{11})(?:[&?/]|$)/);
  return m ? m[1] : null;
}

// The app's own player setup, so a video that works in the dock works here.
document.getElementById('load')!.addEventListener('click', async () => {
  const id = videoIdFrom(vidInput.value);
  if (!id) {
    note('paste an 11-character video id or a youtube link');
    return;
  }
  player?.destroy();
  host.replaceChildren(document.createElement('div'));
  try {
    player = await mountPlayer(host.firstElementChild as HTMLElement, id, { onError: (m) => note(`player: ${m}`) });
    player.play();
    note(`loaded ${id}`);
  } catch (e) {
    note(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function pickMime(): string | null {
  const candidates = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
}

document.getElementById('rec')!.addEventListener('click', async () => {
  note('--- record ---');
  if (!navigator.mediaDevices?.getDisplayMedia) {
    note('FAIL: navigator.mediaDevices.getDisplayMedia is not available here');
    return;
  }
  const mime = pickMime();
  note(`recorder format: ${mime ?? 'none supported'}`);
  if (!mime) return;
  // From the most specific request to the plainest: some browsers throw NotSupportedError on the Chromium-only hints.
  const attempts: [string, DisplayMediaStreamOptions][] = [
    ['tab hints + audio', { video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as DisplayMediaStreamOptions],
    ['preferCurrentTab + audio', { video: true, audio: true, preferCurrentTab: true } as DisplayMediaStreamOptions],
    ['video + audio', { video: true, audio: true }],
    ['video only', { video: true }],
  ];
  let stream: MediaStream | null = null;
  for (const [label, options] of attempts) {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(options);
      note(`capture accepted: ${label}`);
      break;
    } catch (e) {
      note(`capture refused (${label}): ${e instanceof Error ? e.name + ' ' + e.message : String(e)}`);
      if (e instanceof Error && e.name === 'NotAllowedError') return;
    }
  }
  if (!stream) {
    note('FAIL: no capture request was accepted');
    return;
  }
  const v = stream.getVideoTracks()[0];
  const a = stream.getAudioTracks()[0];
  const settings = v?.getSettings() as MediaTrackSettings & { displaySurface?: string };
  note(`video track: ${settings ? `${settings.width}x${settings.height} @${settings.frameRate} surface=${settings.displaySurface ?? '?'}` : 'none'}`);
  note(`audio track: ${a ? a.label || 'present' : 'NONE (tick "Share tab audio" in the picker)'}`);

  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    note(`recorded ${(blob.size / 1024).toFixed(0)} KiB as ${blob.type}`);
    out.src = URL.createObjectURL(blob);
    note('play it back below: is the player visible, is its sound there, is it in sync?');
  };
  const secs = Math.min(60, Math.max(2, Number(secsInput.value) || 8));
  rec.start(500);
  note(`recording ${secs}s`);
  setTimeout(() => rec.state !== 'inactive' && rec.stop(), secs * 1000);
});
