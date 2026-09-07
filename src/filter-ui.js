import { defaultFilters } from './browse.js';

// Text entry is batched; discrete choices apply immediately.
export function bindFilterUpdates(board, paint, delay = 180) {
  let timer;
  const flush = () => {
    clearTimeout(timer);
    if (board.isConnected) paint(1);
  };
  board.addEventListener('input', event => {
    if (!['search', 'text', 'range'].includes(event.target.type)) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  board.addEventListener('change', event => {
    if (['search', 'text', 'range'].includes(event.target.type)) return;
    flush();
  });
  board.addEventListener('submit', event => {
    event.preventDefault();
    flush();
  });
}

export function resetFilterForm(form) {
  const defaults = defaultFilters();
  for (const field of form.elements) {
    if (!field.name) continue;
    if (field.type === 'checkbox') field.checked = field.name === 'recruiting';
    else field.value = defaults[field.name] ?? '';
  }
}
