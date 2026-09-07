import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFilterUpdates, resetFilterForm } from './filter-ui.js';

class Board extends EventTarget { isConnected = true; }
function fire(board, type, fieldType) {
  const event = new Event(type);
  Object.defineProperty(event, 'target', {value:{type:fieldType}});
  board.dispatchEvent(event);
}
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
test('typing is batched; checkbox input and change paint only once', async () => {
  const board = new Board(); let paints = 0;
  bindFilterUpdates(board, () => paints++, 5);
  fire(board, 'input', 'search'); fire(board, 'input', 'search');
  assert.equal(paints, 0); await wait(); assert.equal(paints, 1);
  fire(board, 'input', 'checkbox'); fire(board, 'change', 'checkbox');
  assert.equal(paints, 2); await wait(); assert.equal(paints, 2);
});
test('pending search cannot repaint after leaving the directory', async () => {
  const board = new Board(); let paints = 0;
  bindFilterUpdates(board, () => paints++, 5);
  fire(board, 'input', 'search'); board.isConnected = false;
  await wait(); assert.equal(paints, 0);
});
test('reset clears shared-link defaults as well as later selections', () => {
  const elements = [
    {name:'q',type:'search',value:'saved search'},
    {name:'platform',type:'select-one',value:'PC'},
    {name:'sort',type:'select-one',value:'mr'},
    {name:'mr',type:'range',value:'20'},
    {name:'playstyle',type:'checkbox',checked:true},
    {name:'online',type:'checkbox',checked:true},
    {name:'recruiting',type:'checkbox',checked:false},
  ];
  resetFilterForm({elements});
  assert.deepEqual(elements.map(el => el.type === 'checkbox' ? el.checked : el.value), ['', '', 'newest', '0', false, false, true]);
});
