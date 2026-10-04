import type { DrawContext } from './draw-context';
import { isActive, laneY, noteX, timeToX, type HighwayLayout } from './layout';
import { stringColor, type HighwayTheme } from './theme';
import type { NoteEvent } from '../model/score';

/** Text on the note head: dead notes show an x and ghost notes show the fret in parentheses. */
export function fretLabel(note: NoteEvent): string {
  if (note.techniques.dead) return 'x';
  if (note.techniques.ghost) return `(${note.fret})`;
  return String(note.fret);
}

/** Customary bend size: a half step is ½, a whole step is "full". */
export function bendLabel(semitones: number): string {
  if (semitones <= 0.5) return '¼';
  if (semitones <= 1) return '½';
  if (semitones <= 2) return 'full';
  if (semitones <= 3) return '1½';
  return String(Math.round(semitones / 2));
}

/** Short mark for the tab strip; empty for a plain note. */
export function techniqueMark(note: NoteEvent): string {
  const t = note.techniques;
  const parts: string[] = [];
  if (t.bend > 0) parts.push(`b${bendLabel(t.bend)}`);
  if (t.slide !== 'none') parts.push(t.slide === 'out-down' ? '\\' : '/');
  if (t.hammerPull === 'origin') parts.push('h');
  if (t.palmMute) parts.push('PM');
  if (t.harmonic) parts.push('NH');
  if (t.vibrato) parts.push('~');
  return parts.join(' ');
}

/** The next note after `note` on the same string, from notes sorted by start. */
function nextOnString(note: NoteEvent, notes: readonly NoteEvent[], from: number): NoteEvent | undefined {
  for (let i = from; i < notes.length; i++) {
    const n = notes[i];
    if (n.startSeconds <= note.startSeconds) continue;
    if (n.string === note.string) return n;
  }
  return undefined;
}

/** Draws the technique decorations for the visible notes of a track. */
export function drawTechniques(
  ctx: DrawContext,
  visible: readonly NoteEvent[],
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  for (let i = 0; i < visible.length; i++) {
    const note = visible[i];
    const tech = note.techniques;
    const active = isActive(note, t);
    const x = noteX(layout, note, t);
    const y = laneY(layout, note.string);
    const r = layout.noteRadius;
    const colour = stringColor(theme, note.string);
    ctx.globalAlpha = note.startSeconds < t && !active ? 0.35 : 1;

    if (tech.harmonic) drawDiamond(ctx, x, y, r * 1.35, theme.strikeline);
    if (tech.bend > 0) drawBend(ctx, x, y, r, tech.bend, theme);
    if (tech.palmMute) drawLabel(ctx, 'PM', x, y - r - 8, theme);
    if (tech.vibrato) drawVibrato(ctx, note, x, y, layout, t, colour);

    const slideTarget = tech.slide === 'shift' || tech.slide === 'legato' ? nextOnString(note, visible, i + 1) : undefined;
    if (slideTarget) {
      const x2 = timeToX(layout, slideTarget.startSeconds, t);
      drawConnector(ctx, x + r, y, x2 - r, y + (slideTarget.fret > note.fret ? -r : r), theme.strikeline, false);
    } else if (tech.slide === 'out-down' || tech.slide === 'out-up') {
      const dir = tech.slide === 'out-up' ? -1 : 1;
      drawConnector(ctx, x + r, y, x + r + r * 2.2, y + dir * r * 1.4, theme.strikeline, false);
    } else if (tech.slide === 'in-below' || tech.slide === 'in-above') {
      const dir = tech.slide === 'in-below' ? 1 : -1;
      drawConnector(ctx, x - r - r * 2.2, y + dir * r * 1.4, x - r, y, theme.strikeline, false);
    }

    if (tech.hammerPull === 'origin') {
      const target = nextOnString(note, visible, i + 1);
      if (target) {
        const x2 = timeToX(layout, target.startSeconds, t);
        drawConnector(ctx, x, y - r, x2, y - r, theme.strikeline, true);
        drawLabel(ctx, target.fret > note.fret ? 'H' : 'P', (x + x2) / 2, y - r - 14, theme);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawLabel(ctx: DrawContext, text: string, x: number, y: number, theme: HighwayTheme): void {
  ctx.fillStyle = theme.strikeline;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawDiamond(ctx: DrawContext, x: number, y: number, size: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.stroke();
}

/** An arrow rising from the head with the bend size above it. */
function drawBend(ctx: DrawContext, x: number, y: number, r: number, semitones: number, theme: HighwayTheme): void {
  const rise = r * (1.2 + Math.min(semitones, 4) * 0.6);
  ctx.strokeStyle = theme.strikeline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.6, y - r * 0.4);
  ctx.lineTo(x + r * 0.6, y - r - rise);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.6 - 4, y - r - rise + 6);
  ctx.lineTo(x + r * 0.6, y - r - rise);
  ctx.lineTo(x + r * 0.6 + 4, y - r - rise + 6);
  ctx.stroke();
  drawLabel(ctx, bendLabel(semitones), x + r * 0.6, y - r - rise - 9, theme);
}

function drawConnector(
  ctx: DrawContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  curved: boolean,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (curved) {
    // a shallow arc drawn as a three-point polyline keeps the context interface small
    const midX = (x1 + x2) / 2;
    ctx.lineTo(midX, Math.min(y1, y2) - 6);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawVibrato(
  ctx: DrawContext,
  note: NoteEvent,
  x: number,
  y: number,
  layout: HighwayLayout,
  t: number,
  colour: string,
): void {
  const endX = timeToX(layout, note.endSeconds, t);
  if (endX - x < 12) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + layout.noteRadius, y);
  for (let px = x + layout.noteRadius + 4, i = 0; px < endX; px += 4, i++) {
    ctx.lineTo(px, y + (i % 2 === 0 ? -4 : 4));
  }
  ctx.stroke();
}
