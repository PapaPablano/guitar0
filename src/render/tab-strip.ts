import type { DrawContext } from './draw-context';
import { barSpans } from './bars';
import type { Moment } from './moment';
import { beatTicksFor, flagCount, isDotted, isTriplet, planBeams, TICKS_PER_QUARTER, type BeamPlan } from './tab-beams';
import { labelBoxWidth, planMarks, type MarkPlacement } from './strip-marks';
import { drawStripTechniques } from './strip-techniques';
import { noteName, spellingForTuning } from './note-names';
import { fretLabel } from './techniques';
import { playbackBarIndexAt } from '../model/bars';
import { DEFAULT_THEME, type HighwayTheme } from './theme';
import type { BarEvent, NoteEvent, Timeline } from '../model/score';

/** Room a note needs: two digits at the largest fret-number size, plus a gap to the next. Short notes get no less. */
export const MIN_SLOT_WIDTH = 30;
/** Clear space kept between the label boxes of neighbouring notes. */
const SLOT_GAP = 6;
/** A bar with no notes, or few, is never narrower than this. */
export const MIN_BAR_WIDTH = 90;
/** Width of the fixed clef and time-signature area at the left of the strip. */
export const GUTTER_WIDTH = 96;
export const FRET_FONT_MAX = 16;
export const FRET_FONT_MIN = 11;
/** X of the open-string names, the stacked TAB letters and the time-signature digits inside the gutter. */
const TUNING_X = 13;
const CLEF_X = 40;
const SIGNATURE_X = 70;

/** Space before a bar's first note, so its fret number clears the bar line. */
const LEAD_PAD = MIN_SLOT_WIDTH / 2 + 2;
const CURSOR_FRACTION = 0.3;
/** Gap between the gutter and the cursor on a panel too narrow for the usual fraction. */
const CURSOR_GUTTER_MARGIN = 40;
/** Fret-number colour on the strip's dark background. */
const STRIP_NOTE_TEXT = '#f1f3f5';
const STRIP_BACKGROUND = '#1b1e26';
const BEAT_TICK_COLOR = 'rgba(141, 150, 160, 0.55)';

/** One onset in a bar: every note that starts on the same tick shares it. */
export interface StripSlot {
  readonly tick: number;
  readonly seconds: number;
  /** X of the notes within the bar. */
  readonly offset: number;
  readonly width: number;
  readonly durationTicks: number;
  readonly notes: readonly NoteEvent[];
}

export interface StripBar {
  readonly scoreBar: number;
  /** X in strip space (the whole score laid out left to right in score order). */
  readonly x: number;
  readonly width: number;
  /** The first time this bar is played; repeats reuse its notes. */
  readonly playback: BarEvent;
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
  readonly notes: readonly NoteEvent[];
  readonly slots: readonly StripSlot[];
  /** Where the playhead is within the bar at each note's start second, for the cursor to blend between. */
  readonly secondsAnchors: readonly Anchor[];
  /** X of each inner beat line within the bar, left to right. */
  readonly beatXs: readonly number[];
  readonly beams: BeamPlan;
  /** Technique marks above the staff, each in its lane; the bar is already wide enough for them. */
  readonly marks: readonly MarkPlacement[];
}

export interface StripLayout {
  readonly bars: readonly StripBar[];
  readonly totalWidth: number;
  readonly width: number;
  readonly height: number;
  readonly stringCount: number;
  readonly lineTop: number;
  readonly lineGap: number;
  readonly cursorX: number;
}

export interface LoopBars {
  /** Inclusive score-bar range. */
  readonly startBar: number;
  readonly endBar: number;
}

export interface TabStripOptions {
  readonly theme?: HighwayTheme;
  readonly loop?: LoopBars | null;
  /** How far in from the past edge the cursor sits, as a fraction of the width; today's position when absent. */
  readonly strikeFraction?: number;
  /** The frame's shared moment; its loop and playback bar win over `loop` and the time when given. */
  readonly moment?: Moment;
}

const layoutCache = new WeakMap<Timeline, Map<string, StripLayout>>();

export function getStripLayout(
  timeline: Timeline,
  trackIndex: number,
  width: number,
  height: number,
  cursorFraction: number = CURSOR_FRACTION,
): StripLayout {
  let byKey = layoutCache.get(timeline);
  if (!byKey) {
    byKey = new Map();
    layoutCache.set(timeline, byKey);
  }
  const key = `${trackIndex}:${width}:${height}:${cursorFraction}`;
  let layout = byKey.get(key);
  if (!layout) {
    layout = buildStripLayout(timeline, trackIndex, width, height, cursorFraction);
    byKey.set(key, layout);
  }
  return layout;
}

/** Width of a note's slot: grows with the time to the next note, but slowly, and never below `MIN_SLOT_WIDTH`. */
function slotWidth(gapTicks: number): number {
  const sixteenths = (gapTicks / TICKS_PER_QUARTER) * 4;
  return Math.max(MIN_SLOT_WIDTH, MIN_SLOT_WIDTH * Math.sqrt(Math.max(0, sixteenths)));
}

/** Width of the widest fret label in a group of notes, at the largest font so the layout does not depend on panel height. */
function labelWidth(notes: readonly NoteEvent[]): number {
  return Math.max(...notes.map((n) => labelBoxWidth(fretLabel(n), FRET_FONT_MAX)));
}

function buildSlots(playback: BarEvent, notes: readonly NoteEvent[]): { slots: StripSlot[]; width: number; marks: MarkPlacement[] } {
  const byTick = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const list = byTick.get(n.tick) ?? [];
    list.push(n);
    byTick.set(n.tick, list);
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  const groups = ticks.map((tick) => byTick.get(tick) as NoteEvent[]);
  const widths = ticks.map((tick, i) => {
    const group = groups[i];
    const nextGroup = groups[i + 1];
    const next = nextGroup ? ticks[i + 1] : playback.endTick;
    // never closer to the next note than its label and this one's need, however short the note
    const needed = nextGroup ? (labelWidth(group) + labelWidth(nextGroup)) / 2 + SLOT_GAP : labelWidth(group) / 2 + SLOT_GAP;
    return Math.max(slotWidth(next - tick), needed);
  });

  // Room added before a slot so the technique marks above the staff fit in the lanes the layout allows.
  const extra = ticks.map(() => 0);
  const place = () => {
    const offsets: number[] = [];
    let offset = LEAD_PAD;
    widths.forEach((w, i) => {
      offset += extra[i];
      offsets.push(offset);
      offset += w;
    });
    return { offsets, end: offset };
  };
  const planAt = (offsets: number[]) => planMarks(groups.map((g, i) => ({ offset: offsets[i], notes: g })), FRET_FONT_MAX);
  let laid = place();
  let plan = planAt(laid.offsets);
  // Widening before a slot cannot separate marks that all belong to that slot, so a slot that overflows twice is left as it is.
  let widened = -1;
  for (let pass = 0; plan.overflow && plan.overflow.slot !== widened && pass < groups.length * 4 + 4; pass++) {
    widened = plan.overflow.slot;
    extra[widened] += plan.overflow.shortfall;
    laid = place();
    plan = planAt(laid.offsets);
  }

  const slots: StripSlot[] = ticks.map((tick, i) => ({
    tick,
    seconds: groups[i][0].startSeconds,
    offset: laid.offsets[i],
    width: widths[i],
    durationTicks: groups[i][0].durationTicks,
    notes: groups[i],
  }));
  const markReach = plan.marks.reduce((far, m) => Math.max(far, m.right), 0);
  return { slots, width: slots.length ? Math.max(MIN_BAR_WIDTH, laid.end, markReach) : MIN_BAR_WIDTH, marks: [...plan.marks] };
}

export function buildStripLayout(
  timeline: Timeline,
  trackIndex: number,
  width: number,
  height: number,
  cursorFraction: number = CURSOR_FRACTION,
): StripLayout {
  const stringCount = timeline.tracks[trackIndex]?.stringCount ?? 6;
  const lineTop = height * 0.22;
  const lineGap = (height * 0.42) / Math.max(1, stringCount - 1);

  const notes = timeline.notesForTrack(trackIndex);
  const notesByPlaybackBar = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const list = notesByPlaybackBar.get(n.playbackBar) ?? [];
    list.push(n);
    notesByPlaybackBar.set(n.playbackBar, list);
  }

  const spans = barSpans(timeline).map((span) => {
    const barNotes = notesByPlaybackBar.get(span.playback.playbackIndex) ?? [];
    return { ...span, barNotes, ...buildSlots(span.playback, barNotes) };
  });

  const bars: StripBar[] = [];
  let x = 0;
  spans.forEach(({ scoreBar, playback, repeatStart, repeatEnd, barNotes, slots, marks, width: barWidth }, i) => {
    // The next bar opens on a note a lead pad in from its bar line, so the cursor runs on to that note and does not jump at the line.
    const next = spans[i + 1];
    const endExtra = next && next.slots.length > 0 && next.slots[0].tick === next.playback.startTick ? LEAD_PAD : 0;
    bars.push({
      scoreBar,
      x,
      width: barWidth,
      playback,
      repeatStart,
      repeatEnd,
      notes: barNotes,
      slots,
      secondsAnchors: barAnchors(playback, slots, barWidth, 'seconds', endExtra),
      beatXs: beatXsFor(playback, barAnchors(playback, slots, barWidth, 'tick')),
      beams: planBeams(slots, playback.startTick, playback.timeSignature),
      marks,
    });
    x += barWidth;
  });

  return {
    bars,
    totalWidth: x,
    width,
    height,
    stringCount,
    lineTop,
    lineGap,
    cursorX: Math.max(width * cursorFraction, GUTTER_WIDTH + CURSOR_GUTTER_MARGIN),
  };
}

interface Anchor {
  readonly key: number;
  readonly x: number;
}

/** X within the bar for a key (seconds or ticks), blending straight between the anchors on either side. */
function interpolate(anchors: readonly Anchor[], key: number): number {
  if (key < anchors[0].key) return anchors[0].x;
  let at = 0;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].key <= key) at = i;
    else break;
  }
  if (at === anchors.length - 1) return anchors[at].x;
  const a = anchors[at];
  const b = anchors[at + 1];
  return a.x + ((key - a.key) / (b.key - a.key)) * (b.x - a.x);
}

/** The bar's start, each note's slot and the bar's end, keyed by seconds or by ticks. */
function barAnchors(playback: BarEvent, slots: readonly StripSlot[], width: number, key: 'seconds' | 'tick', endExtra = 0): Anchor[] {
  const start = key === 'seconds' ? playback.startSeconds : playback.startTick;
  const end = key === 'seconds' ? playback.endSeconds : playback.endTick;
  return [{ key: start, x: 0 }, ...slots.map((s) => ({ key: s[key], x: s.offset })), { key: end, x: width + endExtra }];
}

function beatXsFor(playback: BarEvent, tickAnchors: readonly Anchor[]): number[] {
  const beat = beatTicksFor(playback.timeSignature);
  const xs: number[] = [];
  for (let tick = playback.startTick + beat; tick < playback.endTick; tick += beat) {
    xs.push(interpolate(tickAnchors, tick));
  }
  return xs;
}

/** X of the playhead in strip space. Across a repeat this jumps back to the repeated bar. */
export function playheadStripX(layout: StripLayout, timeline: Timeline, t: number): number {
  const played = timeline.bars[playbackBarIndexAt(timeline, t)];
  if (!played) return 0;
  const bar = stripBarFor(layout, played.scoreBar);
  if (!bar) return 0;
  // A repeat plays the bar again later in the song; map that pass onto the first pass the slots were timed on.
  const seconds = played.endSeconds - played.startSeconds;
  const fraction = seconds > 0 ? Math.min(1, Math.max(0, (t - played.startSeconds) / seconds)) : 0;
  const first = bar.playback;
  const key = first.startSeconds + fraction * (first.endSeconds - first.startSeconds);
  return bar.x + interpolate(bar.secondsAnchors, key);
}

/** Strip-space x shown at the left edge of the canvas when the playhead is at `t`. */
export function stripScrollX(layout: StripLayout, timeline: Timeline, t: number): number {
  return playheadStripX(layout, timeline, t) - layout.cursorX;
}

/** The strip bar for a score bar index, if the score has it. */
export function stripBarFor(layout: StripLayout, scoreBar: number): StripBar | undefined {
  return layout.bars.find((b) => b.scoreBar === scoreBar);
}

/** Score bar under a canvas x position, or null when the position is outside the score or over the clef gutter. */
export function scoreBarAtX(layout: StripLayout, timeline: Timeline, t: number, canvasX: number): number | null {
  if (canvasX < GUTTER_WIDTH) return null;
  const stripX = canvasX + stripScrollX(layout, timeline, t);
  for (const bar of layout.bars) {
    if (stripX >= bar.x && stripX < bar.x + bar.width) return bar.scoreBar;
  }
  return null;
}

/** Playback time at the start of a score bar's first pass. */
export function scoreBarStartSeconds(layout: StripLayout, scoreBar: number): number | null {
  return stripBarFor(layout, scoreBar)?.playback.startSeconds ?? null;
}

function staffBottom(layout: StripLayout): number {
  return layout.lineTop + layout.lineGap * (layout.stringCount - 1);
}

function fretFontSize(lineGap: number): number {
  return Math.min(FRET_FONT_MAX, Math.max(FRET_FONT_MIN, Math.round(lineGap * 0.95)));
}

/** Draws the tab strip: staff lines, bars, fret numbers, beamed rhythm, the cursor and the clef gutter. */
export function renderTabStrip(
  ctx: DrawContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: TabStripOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const layout = getStripLayout(timeline, trackIndex, width, height, options.strikeFraction);
  const scroll = stripScrollX(layout, timeline, t);
  const bottom = staffBottom(layout);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = STRIP_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  const visible = layout.bars.filter((b) => b.x + b.width - scroll >= 0 && b.x - scroll <= width);

  const loop = options.moment ? options.moment.loop : options.loop;
  if (loop) {
    const first = stripBarFor(layout, loop.startBar);
    const last = stripBarFor(layout, loop.endBar);
    if (first && last) {
      ctx.fillStyle = 'rgba(77, 171, 247, 0.22)';
      ctx.fillRect(first.x - scroll, 0, last.x + last.width - first.x, height);
    }
  }

  drawStrings(ctx, layout, theme, 0, width);

  // The cursor goes behind the fret numbers so it never hides the note being played.
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.cursorX, layout.lineTop - 14);
  ctx.lineTo(layout.cursorX, bottom + 30);
  ctx.stroke();

  for (const bar of visible) {
    const x = bar.x - scroll;
    ctx.strokeStyle = bar.repeatStart ? theme.strikeline : theme.laneLine;
    ctx.lineWidth = bar.repeatStart ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, layout.lineTop);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (bar.repeatEnd) {
      ctx.strokeStyle = theme.strikeline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + bar.width, layout.lineTop);
      ctx.lineTo(x + bar.width, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = theme.barLabel;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(bar.scoreBar + 1), x + 4, layout.lineTop - 6);
    drawBeatTicks(ctx, bar, layout, x);
    drawBarNotes(ctx, bar, layout, theme, x, bottom);
  }

  drawGutter(ctx, layout, timeline, trackIndex, options.moment?.playbackBar ?? playbackBarIndexAt(timeline, t), theme);
  ctx.restore();
}

function drawStrings(ctx: DrawContext, layout: StripLayout, theme: HighwayTheme, from: number, to: number): void {
  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 1;
  for (let s = 0; s < layout.stringCount; s++) {
    const y = layout.lineTop + s * layout.lineGap;
    ctx.beginPath();
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
    ctx.stroke();
  }
}

function drawBeatTicks(ctx: DrawContext, bar: StripBar, layout: StripLayout, barX: number): void {
  ctx.strokeStyle = BEAT_TICK_COLOR;
  ctx.lineWidth = 1;
  for (const offset of bar.beatXs) {
    ctx.beginPath();
    ctx.moveTo(barX + offset, layout.lineTop - 4);
    ctx.lineTo(barX + offset, layout.lineTop - 11);
    ctx.stroke();
  }
}

function drawBarNotes(
  ctx: DrawContext,
  bar: StripBar,
  layout: StripLayout,
  theme: HighwayTheme,
  barX: number,
  bottom: number,
): void {
  const fontSize = fretFontSize(layout.lineGap);
  const fretFont = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = fretFont;
  for (const slot of bar.slots) {
    const x = barX + slot.offset;
    for (const n of slot.notes) {
      const y = layout.lineTop + (n.string - 1) * layout.lineGap;
      const label = fretLabel(n);
      const boxWidth = labelBoxWidth(label, fontSize);
      // break the string behind the number so it stays readable
      ctx.fillStyle = STRIP_BACKGROUND;
      ctx.fillRect(x - boxWidth / 2, y - fontSize / 2 - 1, boxWidth, fontSize + 2);
      ctx.fillStyle = STRIP_NOTE_TEXT;
      ctx.fillText(label, x, y);
    }
  }
  drawStripTechniques(ctx, bar, layout, theme, barX, fontSize);
  drawRhythm(ctx, bar, layout, theme, barX, bottom);
}

/** Stems under the staff, joined by beams per beat; a lone short note keeps its flags. */
function drawRhythm(
  ctx: DrawContext,
  bar: StripBar,
  layout: StripLayout,
  theme: HighwayTheme,
  barX: number,
  bottom: number,
): void {
  const stemTop = bottom + 8;
  const stemLength = Math.min(22, Math.max(8, layout.height - bottom - 14));
  const stemBottom = stemTop + stemLength;
  const plan = bar.beams;
  const xOf = (i: number) => barX + bar.slots[i].offset;

  ctx.strokeStyle = theme.barLabel;
  ctx.lineWidth = 1;
  bar.slots.forEach((slot, i) => {
    if (slot.durationTicks >= TICKS_PER_QUARTER * 4) return;
    ctx.beginPath();
    ctx.moveTo(xOf(i), stemTop);
    ctx.lineTo(xOf(i), stemBottom);
    ctx.stroke();
  });

  for (const i of plan.flagged) {
    const flags = flagCount(bar.slots[i].durationTicks);
    for (let f = 0; f < flags; f++) {
      ctx.beginPath();
      ctx.moveTo(xOf(i), stemBottom - f * 4);
      ctx.lineTo(xOf(i) + 6, stemBottom - 4 - f * 4);
      ctx.stroke();
    }
  }

  ctx.fillStyle = theme.barLabel;
  bar.slots.forEach((slot, i) => {
    if (slot.durationTicks >= TICKS_PER_QUARTER * 4 || !isDotted(slot.durationTicks)) return;
    ctx.beginPath();
    ctx.arc(xOf(i) + 5, stemBottom - 2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.lineWidth = 3;
  for (const group of plan.groups) {
    const first = group.members[0];
    const last = group.members[group.members.length - 1];
    beam(ctx, xOf(first), xOf(last), stemBottom);
    if (group.members.every((m) => isTriplet(bar.slots[m].durationTicks))) {
      drawTripletBracket(ctx, xOf(first), xOf(last), stemBottom, layout.height, theme.barLabel);
      ctx.lineWidth = 3;
    }
    for (const seg of group.segments) {
      const y = stemBottom - (seg.level - 1) * 5;
      if (seg.from !== seg.to) {
        beam(ctx, xOf(group.members[seg.from]), xOf(group.members[seg.to]), y);
      } else {
        const x = xOf(group.members[seg.from]);
        const isLast = seg.from === group.members.length - 1;
        beam(ctx, isLast ? x - 6 : x, isLast ? x : x + 6, y);
      }
    }
  }
}

/** A "3" under a bracket across a beamed group whose every note is a triplet value, drawn only where the panel has room. */
function drawTripletBracket(ctx: DrawContext, from: number, to: number, stemBottom: number, height: number, colour: string): void {
  const y = stemBottom + 6;
  if (y + 8 > height) return;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(from, y - 3);
  ctx.lineTo(from, y);
  ctx.lineTo(to, y);
  ctx.lineTo(to, y - 3);
  ctx.stroke();
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('3', (from + to) / 2, y + 1);
}

function beam(ctx: DrawContext, fromX: number, toX: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX, y);
  ctx.stroke();
}

/** The fixed clef and time-signature area: an opaque panel that notes scroll under. */
function drawGutter(ctx: DrawContext, layout: StripLayout, timeline: Timeline, trackIndex: number, playbackBar: number, theme: HighwayTheme): void {
  const bottom = staffBottom(layout);
  const middle = (layout.lineTop + bottom) / 2;
  ctx.fillStyle = STRIP_BACKGROUND;
  ctx.fillRect(0, 0, GUTTER_WIDTH, layout.height);
  drawStrings(ctx, layout, theme, 0, GUTTER_WIDTH);

  const clefSize = Math.min(22, Math.max(12, Math.round(layout.lineGap * 1.1)));
  ctx.fillStyle = theme.barLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${clefSize}px system-ui, sans-serif`;
  const step = clefSize * 1.05;
  ctx.fillText('T', CLEF_X, middle - step);
  ctx.fillText('A', CLEF_X, middle);
  ctx.fillText('B', CLEF_X, middle + step);

  // open-string names beside their lines, top string first, as printed tab shows the tuning
  const tuning = timeline.tracks[trackIndex]?.tuning ?? [];
  const spelling = spellingForTuning(tuning);
  ctx.font = `600 ${Math.min(12, Math.max(9, Math.round(layout.lineGap * 0.8)))}px system-ui, sans-serif`;
  tuning.forEach((open, i) => {
    if (i < layout.stringCount) ctx.fillText(noteName(open, spelling), TUNING_X, layout.lineTop + i * layout.lineGap);
  });

  const signature = timeline.bars[playbackBar]?.timeSignature;
  if (signature) {
    const signatureSize = Math.min(24, Math.max(14, Math.round(layout.lineGap * 1.3)));
    ctx.fillStyle = STRIP_NOTE_TEXT;
    ctx.font = `600 ${signatureSize}px system-ui, sans-serif`;
    ctx.fillText(String(signature.numerator), SIGNATURE_X, middle - signatureSize * 0.55);
    ctx.fillText(String(signature.denominator), SIGNATURE_X, middle + signatureSize * 0.55);
  }

  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(GUTTER_WIDTH, layout.lineTop);
  ctx.lineTo(GUTTER_WIDTH, bottom);
  ctx.stroke();
}
