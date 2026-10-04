import { describe, expect, it } from 'vitest';
import { fileTuningOptions, WRITTEN } from '../../src/app/file-tuning-options';
import { presetById } from '../../src/model/retune';

const std = presetById('standard')!.tuning;
const half = presetById('half-down')!.tuning;

describe('fileTuningOptions', () => {
  it('names the written tuning, and lists every other tuning with the same string count', () => {
    const { options } = fileTuningOptions(std, std);
    expect(options[0]).toEqual({ id: WRITTEN, label: 'As written (Standard (E A D G B E))' });
    expect(options.map((o) => o.id)).toContain('half-down');
    expect(options.map((o) => o.id)).not.toContain('standard');
  });

  it('covers the case from the bug: a file written as standard can be set to half a step down', () => {
    const { options, value } = fileTuningOptions(std, std);
    expect(value).toBe(WRITTEN);
    expect(options.find((o) => o.id === 'half-down')).toBeDefined();
  });

  it('shows the tuning the file was reinterpreted as', () => {
    expect(fileTuningOptions(std, half).value).toBe('half-down');
  });

  it('can offer standard again when the file was written in another tuning', () => {
    const { options } = fileTuningOptions(half, half);
    expect(options[0].label).toBe('As written (Half step down)');
    expect(options.map((o) => o.id)).toContain('standard');
  });

  it('calls an unnamed written tuning just "As written"', () => {
    const odd = [64, 59, 55, 50, 45, 41];
    expect(fileTuningOptions(odd, odd).options[0].label).toBe('As written');
  });

  it('falls back to the written entry when the current tuning matches no preset', () => {
    expect(fileTuningOptions(std, [60, 59, 55, 50, 45, 40]).value).toBe(WRITTEN);
  });

  it('offers nothing for a track with no usable tuning', () => {
    expect(fileTuningOptions([], []).options).toEqual([]);
  });
});
