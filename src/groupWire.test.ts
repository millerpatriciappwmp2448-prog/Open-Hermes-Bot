import { describe, expect, it } from 'vitest';
import { decodeGroupRecord, encodeGroupRecord } from './groupWire';

describe('length-delimited Hermes group records', () => {
  it.each(['user', 'member', 'note'] as const)('round trips a %s without interpreting its quoted lines', kind => {
    const record = { id: 'input:"one\\two', kind, name: kind === 'member' ? 'Chief. Staff' : '',
      text: '\n@You: literal\n@@hermes-message-v1 {"lines":1}\n(note) literal\n\n' };
    const lines = encodeGroupRecord(record).split('\n');
    expect(decodeGroupRecord(lines, 0)).toEqual({ record, count: lines.length });
  });

  it('leaves old transcript lines to the legacy reader', () => {
    expect(decodeGroupRecord(['@You: Hello'], 0)).toBeNull();
  });

  it.each([
    'invalid json', 'null', '{}',
    '{"id":"a","kind":"unknown","name":"","lines":1}',
    '{"id":"a","kind":"user","name":null,"lines":1}',
    '{"id":3,"kind":"user","name":"","lines":1}',
    '{"id":"","kind":"user","name":"","lines":1}',
    '{"id":"a","kind":"user","name":"","lines":0}',
    '{"id":"a","kind":"user","name":"","lines":1.5}',
    '{"id":"a","kind":"user","name":"","lines":3}',
    '{"id":"a","kind":"user","name":"","lines":true}',
  ])('rejects malformed metadata %s', meta => {
    expect(decodeGroupRecord(['@@hermes-message-v1 ' + meta, '@You: Hello'], 0)).toBeNull();
  });

  it('requires the body attribution to match its record', () => {
    expect(decodeGroupRecord(['@@hermes-message-v1 {"id":"a","kind":"member","name":"Bob","lines":1}', '@You: Hello'], 0)).toBeNull();
  });
});
