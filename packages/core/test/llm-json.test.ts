import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/llm/json.js';

const payload = { requirements: [{ text: 'React', kind: 'technical' }] };

describe('extractJson - shapes a model actually returns', () => {
  it('parses a bare JSON object', () => {
    const result = extractJson(JSON.stringify(payload));
    expect(result).toMatchObject({ ok: true, source: 'direct', value: payload });
  });

  it('parses a bare JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toMatchObject({ ok: true, value: [1, 2, 3] });
  });

  it('parses JSON wrapped in a ```json fence', () => {
    const raw = ['```json', JSON.stringify(payload, null, 2), '```'].join('\n');
    expect(extractJson(raw)).toMatchObject({
      ok: true,
      source: 'fenced',
      value: payload,
    });
  });

  it('parses JSON wrapped in a bare ``` fence', () => {
    const raw = ['```', JSON.stringify(payload), '```'].join('\n');
    expect(extractJson(raw)).toMatchObject({
      ok: true,
      source: 'fenced',
      value: payload,
    });
  });

  it('parses JSON preceded by prose', () => {
    const raw = `Certainly! Here is the JSON you asked for:\n${JSON.stringify(payload)}`;
    expect(extractJson(raw)).toMatchObject({
      ok: true,
      source: 'embedded',
      value: payload,
    });
  });

  it('parses JSON with prose on both sides', () => {
    const raw = `Sure thing.\n${JSON.stringify(payload)}\nLet me know if you need more.`;
    expect(extractJson(raw)).toMatchObject({ ok: true, value: payload });
  });

  it('does not stop at a brace inside a string value', () => {
    const tricky = { note: 'a closing brace } inside a string', ok: true };
    const raw = `Here you go: ${JSON.stringify(tricky)} - done.`;
    expect(extractJson(raw)).toMatchObject({ ok: true, value: tricky });
  });

  it('does not stop at an escaped quote inside a string value', () => {
    const tricky = { note: 'he said \"maybe\" and left' };
    const raw = `Result: ${JSON.stringify(tricky)}`;
    expect(extractJson(raw)).toMatchObject({ ok: true, value: tricky });
  });

  it('handles nested objects and arrays', () => {
    const nested = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(extractJson(`prefix ${JSON.stringify(nested)}`)).toMatchObject({
      ok: true,
      value: nested,
    });
  });
});

describe('extractJson - failures', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n  '],
    ['plain prose', 'I am sorry, I cannot help with that request.'],
    ['truncated JSON', '{"requirements": [{"text": "unterminated"'],
    ['unbalanced braces', '{{{'],
  ])('reports %s as unparseable', (_label, raw) => {
    const result = extractJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('distinguishes an empty response from unparseable content', () => {
    const empty = extractJson('');
    const prose = extractJson('no json here');
    expect(empty.ok).toBe(false);
    expect(prose.ok).toBe(false);
    if (!empty.ok && !prose.ok) expect(empty.reason).not.toBe(prose.reason);
  });

  it('is deterministic', () => {
    const raw = `prose ${JSON.stringify(payload)}`;
    expect(extractJson(raw)).toEqual(extractJson(raw));
  });
});
