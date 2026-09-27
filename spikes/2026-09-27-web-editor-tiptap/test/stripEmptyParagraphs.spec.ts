// Brief 03, task 1/7 (unit test for the empty-paragraph wrapper).
import { describe, expect, it } from 'vitest';
import { schema } from '../src/model/schema.js';
import { serializeDoc } from '../src/model/serialize.js';
import { stripEmptyTopLevelParagraphs } from '../src/editing/stripEmptyParagraphs.js';

function para(text: string, src: string | null, gap: string | null) {
  return schema.node('paragraph', { src, gap }, text ? [schema.text(text)] : []);
}

function emptyPara() {
  return schema.node('paragraph', { src: null, gap: null }, []);
}

describe('stripEmptyTopLevelParagraphs', () => {
  it('removes a trailing empty paragraph and nulls the survivor gap', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('Hello.', 'Hello.', '\n'), emptyPara()]);
    const stripped = stripEmptyTopLevelParagraphs(doc);
    expect(stripped.childCount).toBe(1);
    expect(stripped.child(0).textContent).toBe('Hello.');
    expect(stripped.child(0).attrs.gap).toBe(null);
    // serializeDoc must not throw now, and must reproduce the original bytes
    // (single trailing eol, the doc's own default-separator fallback).
    expect(serializeDoc(stripped)).toBe('Hello.\n');
  });

  it('removes an empty paragraph in the middle and nulls the preceding gap', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [
      para('First.', 'First.', '\n\n'),
      emptyPara(),
      para('Second.', 'Second.', '\n'),
    ]);
    const stripped = stripEmptyTopLevelParagraphs(doc);
    expect(stripped.childCount).toBe(2);
    expect(stripped.child(0).attrs.gap).toBe(null);
    expect(serializeDoc(stripped)).toBe('First.\n\nSecond.\n');
  });

  it('removes several consecutive empty paragraphs', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('Only.', 'Only.', '\n\n'), emptyPara(), emptyPara()]);
    const stripped = stripEmptyTopLevelParagraphs(doc);
    expect(stripped.childCount).toBe(1);
    expect(stripped.child(0).attrs.gap).toBe(null);
  });

  it('is a no-op when there is no empty paragraph', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [para('Hello.', 'Hello.', '\n')]);
    const stripped = stripEmptyTopLevelParagraphs(doc);
    expect(stripped).toBe(doc);
  });

  it('leaves a doc consisting only of one empty paragraph unchanged (nothing to keep)', () => {
    const doc = schema.node('doc', { lead: '', eol: '\n' }, [emptyPara()]);
    const stripped = stripEmptyTopLevelParagraphs(doc);
    expect(stripped).toBe(doc);
  });
});
