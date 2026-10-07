import type { NoteEvent } from '../model/score';
import type { DrawContext } from './draw-context';
import type { CometCue, NeckCues } from './neck-cue-model';
import { stringColor, type HighwayTheme } from './theme';

/** Where things are on the screen, as the neck view places them; the cues are drawn without knowing about the photo. */
export interface NeckSpace {
  /** The ring of a note as drawn: its centre and radius, where its finger is while it moves. */
  ring(note: NoteEvent): { x: number; y: number; r: number };
  /** The ring of a note at rest, ignoring any motion. */
  rest(note: NoteEvent): { x: number; y: number; r: number };
  /** The point on a string at a fret, which may be between whole frets. */
  at(string: number, fret: number): { x: number; y: number };
  /** Screen pixels per photo pixel, to keep line widths in step with the picture. */
  readonly scale: number;
}

/** The colour of the harmonic diamond, the glass tone the neck's fret wires use. */
const GLASS = '#9fe8ff';
const PULSE = '#ffffff';

/** A soft wide glow under a bright core, in one colour: the look the lit strings have. */
function glowStroke(ctx: DrawContext, colour: string, width: number, alpha: number, trace: () => void): void {
  ctx.strokeStyle = colour;
  for (const [grow, share] of [[3, 0.14], [1.8, 0.28], [0.7, 1]] as const) {
    ctx.globalAlpha = alpha * share;
    ctx.lineWidth = width * grow;
    ctx.beginPath();
    trace();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** An arc over the pair of rings of a hammer-on or pull-off, springing from the top of each ring and rising away from the strings. */
function drawArcs(ctx: DrawContext, space: NeckSpace, cues: NeckCues, theme: HighwayTheme): void {
  for (const { from, to } of cues.arcs) {
    const a = space.ring(from);
    const b = space.ring(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // the arc rises to the side of the line between the rings that is higher on the screen
    const nx = -(b.y - a.y) / (length || 1);
    const ny = (b.x - a.x) / (length || 1);
    const up = ny <= 0 ? 1 : -1;
    const lift = Math.max(a.r * 1.6, length * 0.45);
    const cx = (a.x + b.x) / 2 + nx * up * lift;
    const cy = (a.y + b.y) / 2 + ny * up * lift;
    const start = { x: a.x + nx * up * a.r, y: a.y + ny * up * a.r };
    const end = { x: b.x + nx * up * b.r, y: b.y + ny * up * b.r };
    glowStroke(ctx, stringColor(theme, from.string), Math.max(1.5, space.scale * 1.4), 0.9, () => {
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(cx, cy, end.x, end.y);
    });
  }
}

/** A bright head with a tail that fades behind it, along the string between two frets. */
function drawComet(ctx: DrawContext, space: NeckSpace, comet: CometCue, theme: HighwayTheme): void {
  const { note, fromFret, toFret, head, strength } = comet;
  if (strength <= 0.01 || fromFret === toFret) return;
  const colour = stringColor(theme, note.string);
  const point = (p: number) => space.at(note.string, fromFret + (toFret - fromFret) * p);
  const tail = 0.35 + 0.2 * Math.min(1, Math.abs(toFret - fromFret) / 6);
  const pieces = 8;
  const width = Math.max(2.5, space.scale * 3.2);
  ctx.strokeStyle = colour;
  for (let i = 0; i < pieces; i++) {
    const p0 = Math.max(0, head - (tail * (i + 1)) / pieces);
    const p1 = Math.max(0, head - (tail * i) / pieces);
    if (p1 <= p0) continue;
    const a = point(p0);
    const b = point(p1);
    const fade = 1 - i / pieces;
    for (const [grow, share] of [[2.4, 0.18], [1, 1]] as const) {
      ctx.globalAlpha = strength * fade * share * 0.9;
      ctx.lineWidth = width * grow * (0.5 + 0.5 * fade);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  const at = point(head);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = strength * 0.25;
  ctx.beginPath();
  ctx.arc(at.x, at.y, width * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.globalAlpha = strength;
  ctx.beginPath();
  ctx.arc(at.x, at.y, width * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A diamond around the ring of a harmonic. */
function drawDiamond(ctx: DrawContext, space: NeckSpace, note: NoteEvent): void {
  const { x, y, r } = space.ring(note);
  const size = r * 1.5;
  ctx.strokeStyle = GLASS;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = Math.max(1.5, space.scale * 1.2);
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A dot travelling from one ring to the next with a short tail, so the eye knows where the hand goes and when. */
function drawPulse(ctx: DrawContext, space: NeckSpace, cues: NeckCues): void {
  const pulse = cues.pulse;
  if (!pulse) return;
  const a = space.rest(pulse.from);
  const b = space.rest(pulse.to);
  const at = (p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
  const radius = Math.max(3, Math.min(a.r, b.r) * 0.38);
  ctx.fillStyle = PULSE;
  for (let i = 3; i >= 0; i--) {
    const p = Math.max(0, pulse.progress - i * 0.05);
    const point = at(p);
    ctx.globalAlpha = i === 0 ? 0.95 : 0.4 - i * 0.1;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * (i === 0 ? 1 : 0.85 - i * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  const head = at(pulse.progress);
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(head.x, head.y, radius * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Draws the arcs, comets, diamonds and the pulse over the rings. Nothing here draws text. */
export function drawNeckCues(ctx: DrawContext, space: NeckSpace, cues: NeckCues, theme: HighwayTheme): void {
  drawArcs(ctx, space, cues, theme);
  for (const comet of cues.comets) drawComet(ctx, space, comet, theme);
  for (const note of cues.harmonics) drawDiamond(ctx, space, note);
  drawPulse(ctx, space, cues);
}
