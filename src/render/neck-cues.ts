import type { NoteEvent } from '../model/score';
import type { DrawContext } from './draw-context';
import { BEND_REACH, type BendCue, type CometCue, type NeckCues } from './neck-cue-model';
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
  /** The size of the frame being drawn, which the bend inset stays inside. */
  readonly width: number;
  readonly height: number;
  /** How many strings the track has. */
  readonly stringCount: number;
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

/** Where the bend inset's parts are on the screen: a small end-on view of the strings, the finger pushing one of them sideways. */
export interface InsetShape {
  /** The four corners of the inset's panel. */
  readonly corners: readonly { x: number; y: number }[];
  /** Where each string's dot is at rest, from the highest-pitched string, in the order the strings run on screen. */
  readonly strings: readonly { x: number; y: number }[];
  /** Which of `strings` is bent. */
  readonly index: number;
  /** Where the bent string's dot is, pushed along the row. */
  readonly pushed: { x: number; y: number };
  /** The gap between dots, in screen pixels. */
  readonly spacing: number;
}

const unit = (dx: number, dy: number, fallback: { x: number; y: number }) => {
  const length = Math.hypot(dx, dy);
  return length < 1e-9 ? fallback : { x: dx / length, y: dy / length };
};

/**
 * The inset for a bend: strings as a row of dots, ordered the way the strings run on screen, with the bent string's dot pushed
 * along the row the way the string is pushed. The panel sits just behind the bending ring, toward the nut, and is kept
 * inside the frame. Null when the strings cannot be placed.
 */
export function bendInset(space: NeckSpace, bend: BendCue): InsetShape | null {
  const { note, amount, side } = bend;
  const count = space.stringCount;
  if (count < 2) return null;
  const ring = space.ring(note);
  const first = space.at(1, note.fret);
  const last = space.at(count, note.fret);
  const along = unit(last.x - first.x, last.y - first.y, { x: 0, y: 1 });
  const here = space.at(note.string, note.fret);
  const ahead = space.at(note.string, note.fret + 4);
  const toBridge = unit(ahead.x - here.x, ahead.y - here.y, { x: 1, y: 0 });
  const spacing = Math.max(7, Math.min(16, ring.r * 1.4));
  const length = count * spacing;
  const depth = spacing * 3;
  const back = depth / 2 + ring.r * 2.5;
  let cx = ring.x - toBridge.x * back;
  let cy = ring.y - toBridge.y * back;
  const halfX = (Math.abs(along.x) * length + Math.abs(toBridge.x) * depth) / 2;
  const halfY = (Math.abs(along.y) * length + Math.abs(toBridge.y) * depth) / 2;
  cx = Math.max(halfX, Math.min(space.width - halfX, cx));
  cy = Math.max(halfY, Math.min(space.height - halfY, cy));
  const at = (a: number, b: number) => ({ x: cx + along.x * a + toBridge.x * b, y: cy + along.y * a + toBridge.y * b });
  const strings = Array.from({ length: count }, (_, i) => at((i - (count - 1) / 2) * spacing, 0));
  const index = note.string - 1;
  const push = side * amount * BEND_REACH * spacing;
  return {
    corners: [at(-length / 2, -depth / 2), at(length / 2, -depth / 2), at(length / 2, depth / 2), at(-length / 2, depth / 2)],
    strings,
    index,
    pushed: { x: strings[index].x + along.x * push, y: strings[index].y + along.y * push },
    spacing,
  };
}

/** The inset of the lowest-pitched bend sounding: a panel, the strings as dots, and a fingertip pushing the bent one. */
function drawBendInset(ctx: DrawContext, space: NeckSpace, cues: NeckCues, theme: HighwayTheme): void {
  const bend = cues.bends[0];
  if (!bend) return;
  const shape = bendInset(space, bend);
  if (!shape) return;
  const fade = Math.min(1, bend.amount * 3);
  const colour = stringColor(theme, bend.note.string);
  ctx.beginPath();
  ctx.moveTo(shape.corners[0].x, shape.corners[0].y);
  for (const c of shape.corners.slice(1)) ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.fillStyle = '#03141a';
  ctx.globalAlpha = 0.6 * fade;
  ctx.fill();
  ctx.strokeStyle = GLASS;
  ctx.lineWidth = Math.max(1, space.scale);
  ctx.globalAlpha = 0.4 * fade;
  ctx.stroke();
  const dot = shape.spacing * 0.14;
  ctx.fillStyle = '#9fb4bd';
  ctx.globalAlpha = 0.75 * fade;
  shape.strings.forEach((p, i) => {
    if (i === shape.index) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, dot, 0, Math.PI * 2);
    ctx.fill();
  });
  const rest = shape.strings[shape.index];
  glowStroke(ctx, colour, Math.max(1.5, shape.spacing * 0.12), 0.8 * fade, () => {
    ctx.moveTo(rest.x, rest.y);
    ctx.lineTo(shape.pushed.x, shape.pushed.y);
  });
  const pad = shape.spacing * 0.42;
  ctx.fillStyle = '#03141a';
  ctx.globalAlpha = 0.75 * fade;
  ctx.beginPath();
  ctx.arc(shape.pushed.x, shape.pushed.y, pad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1.5, shape.spacing * 0.12);
  ctx.globalAlpha = fade;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(shape.pushed.x, shape.pushed.y, dot * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Draws the arcs, comets, diamonds, the pulse and the bend inset over the rings. Nothing here draws text. */
export function drawNeckCues(ctx: DrawContext, space: NeckSpace, cues: NeckCues, theme: HighwayTheme): void {
  drawArcs(ctx, space, cues, theme);
  for (const comet of cues.comets) drawComet(ctx, space, comet, theme);
  for (const note of cues.harmonics) drawDiamond(ctx, space, note);
  drawPulse(ctx, space, cues);
  drawBendInset(ctx, space, cues, theme);
}
