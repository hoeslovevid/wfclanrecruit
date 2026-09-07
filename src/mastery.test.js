import test from 'node:test';
import assert from 'node:assert/strict';
import { masteryDisplay } from './mastery.js';
test('rank badge uses its matching local asset', () => {
  assert.match(masteryDisplay(7), /mastery\/7.png/);
  assert.match(masteryDisplay(7), /7\+/);
  assert.match(masteryDisplay(31), /mastery\/31.png/);
  assert.match(masteryDisplay(31), /LR1\+/);
  assert.match(masteryDisplay(32), /LR2\+/);
  assert.match(masteryDisplay(36, false), /LR6<\/span>/);
});
test('invalid requirements never make image URLs', () => {
  for (const value of [-1, 37, 1.5, '<script>', undefined]) {
    assert.equal(masteryDisplay(value), 'Any');
  }
});
test('slider display keeps zero and omits requirement suffix', () => {
  assert.match(masteryDisplay(0, false), /mastery\/0.png/);
  assert.match(masteryDisplay(0, false), />0<\/span>/);
  assert.match(masteryDisplay(0), />Any<\/span>/);
  assert.doesNotMatch(masteryDisplay('12', false), /12\+/);
});
