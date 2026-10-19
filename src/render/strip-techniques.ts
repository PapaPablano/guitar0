import type { DrawContext } from './draw-context';
import type { StripBar, StripLayout } from './tab-strip';
import { ARROW_RUN, labelBoxWidth, markLaneY, MARK_FONT_SIZE, PM_DASH_FROM, PM_REACH_LEFT, PM_REACH_RIGHT, type MarkPlacement } from './strip-marks';
import { fretLabel } from './techniques';
import type { HighwayTheme } from './theme';
import type { NoteEvent } from '../model/score';


const MARK_FONT = `bold ${MARK_FONT_SIZE}px system-ui, sans-serif`;
const SLIDE_STUB = 10;

/** The next note on the same string after slot `from`, within the bar. */
function nextOnString(bar: StripBar, from: number, note: NoteEvent): { note: NoteEvent; slot: number } | undefined {
  for (let i = from + 1; i < bar.slots.length; i++) {
    const hit = bar.slots[i].notes.find((n) => n.string === note.string);
    if (hit) return { note: hit, slot: i };
  }
  return undefined;
}

/**
 * Draws what a note's technique looks like in printed tab: a bend arrow with its size, a slur arc over a hammer-on,
 * pull-off or tie, a slide line, a vibrato wave, a diamond and "Harm." for a harmonic, and one dashed "P.M." bracket
 * over a run of palm-muted notes. Bends, harmonic labels and palm-mute brackets sit in the lanes the layout planned.
 */
export function drawStripTechniques(
  ctx: DrawContext,
  bar: StripBar,
  layout: StripLayout,
  theme: HighwayTheme,
  barX: number,
  fontSize: number,
): void {
  const colour = theme.barLabel;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  bar.slots.forEach((slot, si) => {
    const x = barX + slot.offset;
    for (const n of slot.notes) {
      const y = layout.lineTop + (n.string - 1) * layout.lineGap;
      const half = labelBoxWidth(fretLabel(n), fontSize) / 2;
      const tech = n.techniques;
      if (tech.harmonic) drawDiamond(ctx, x, y, half + 1, fontSize / 2 + 2, colour);
      const target = nextOnString(bar, si, n);
      const targetX = target ? barX + bar.slots[target.slot].offset : x + half + 14;
      const targetHalf = target ? labelBoxWidth(fretLabel(target.note), fontSize) / 2 : 0;
      if (tech.hammerPull === 'origin' || target?.note.techniques.tied) {
        if (target) drawSlur(ctx, x + half, targetX - targetHalf, y - fontSize / 2 - 1, colour);
      }
      if (target && (tech.slide === 'shift' || tech.slide === 'legato')) {
        const rising = target.note.fret > n.fret;
        const lean = layout.lineGap * 0.3 * (rising ? -1 : 1);
        drawLine(ctx, x + half + 1, y - lean, targetX - targetHalf - 1, y + lean, colour);
      } else if (tech.slide === 'out-down' || tech.slide === 'out-up') {
        const lean = tech.slide === 'out-up' ? -1 : 1;
        drawLine(ctx, x + half + 1, y - lean * 3, x + half + 1 + SLIDE_STUB, y + lean * 3, colour);
      } else if (tech.slide === 'in-below' || tech.slide === 'in-above') {
        const lean = tech.slide === 'in-above' ? -1 : 1;
        drawLine(ctx, x - half - 1 - SLIDE_STUB, y + lean * 3, x - half - 1, y - lean * 3, colour);
      }
      if (tech.vibrato) drawVibrato(ctx, x + half, targetX - targetHalf, y - fontSize / 2 - 5, colour);
    }
  });

  for (const mark of bar.marks) drawMark(ctx, mark, bar, layout, barX, fontSize, colour);
}

function drawText(ctx: DrawContext, text: string, x: number, y: number, colour: string, align: CanvasTextAlign): void {
  ctx.fillStyle = colour;
  ctx.font = MARK_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawLine(ctx: DrawContext, x1: number, y1: number, x2: number, y2: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A shallow arc over the gap between two notes. */
function drawSlur(ctx: DrawContext, x1: number, x2: number, y: number, colour: string): void {
  if (x2 - x1 < 4) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.quadraticCurveTo((x1 + x2) / 2, y - 9, x2, y);
  ctx.stroke();
}

/** A curve rising from the note to an arrowhead under its lane, with the bend size in the lane. */
function drawBendArrow(ctx: DrawContext, x: number, y: number, laneY: number, text: string, colour: string): void {
  const tipY = Math.min(y - 6, laneY + 6);
  const tipX = x + ARROW_RUN;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(tipX, y - (y - tipY) * 0.2, tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX - 3, tipY + 5);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + 3, tipY + 5);
  ctx.stroke();
  drawText(ctx, text, tipX, laneY, colour, 'center');
}

function drawDiamond(ctx: DrawContext, x: number, y: number, halfWidth: number, halfHeight: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - halfHeight);
  ctx.lineTo(x + halfWidth, y);
  ctx.lineTo(x, y + halfHeight);
  ctx.lineTo(x - halfWidth, y);
  ctx.closePath();
  ctx.stroke();
}

function drawVibrato(ctx: DrawContext, fromX: number, toX: number, y: number, colour: string): void {
  const end = Math.max(toX, fromX + 12);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  for (let px = fromX + 3, i = 0; px <= end; px += 3, i++) {
    ctx.lineTo(px, y + (i % 2 === 0 ? -2 : 2));
  }
  ctx.stroke();
}

/** A mark in its planned lane; a harmonic label or palm-mute bracket raised above lane 0 gets a thin leader down to the staff. */
function drawMark(
  ctx: DrawContext,
  mark: MarkPlacement,
  bar: StripBar,
  layout: StripLayout,
  barX: number,
  fontSize: number,
  colour: string,
): void {
  const laneY = markLaneY(layout.lineTop, mark.lane);
  const slotX = barX + bar.slots[mark.slot].offset;
  if (mark.kind === 'bend' && mark.note) {
    const y = layout.lineTop + (mark.note.string - 1) * layout.lineGap;
    drawBendArrow(ctx, slotX + mark.arrowOffset, y - fontSize / 2, laneY, mark.text, colour);
    return;
  }
  if (mark.lane > 0) drawLeader(ctx, barX + mark.stemX, laneY + 5, layout.lineTop - 6, colour);
  if (mark.kind === 'harmonic') {
    drawText(ctx, mark.text, slotX, laneY, colour, 'center');
    return;
  }
  const startX = slotX - PM_REACH_LEFT;
  const endX = barX + bar.slots[mark.lastSlot].offset + PM_REACH_RIGHT;
  drawText(ctx, mark.text, startX, laneY, colour, 'left');
  const dashFrom = startX + PM_DASH_FROM;
  if (endX > dashFrom) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dashFrom, laneY);
    ctx.lineTo(endX, laneY);
    ctx.lineTo(endX, laneY + 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawLeader(ctx: DrawContext, x: number, fromY: number, toY: number, colour: string): void {
  if (toY <= fromY) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(x, fromY);
  ctx.lineTo(x, toY);
  ctx.stroke();
  ctx.setLineDash([]);
}
