// Icon numbers follow the wiki's rank sequence, including legendary ranks.
export function masteryLabel(rank) {
  return Number(rank) > 30 ? `LR${Number(rank) - 30}` : String(rank);
}

export function masteryDisplay(value, requirement = true) {
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 0 || rank > 36) return requirement ? 'Any' : '0';
  const label = rank === 0 && requirement ? 'Any' : `${masteryLabel(rank)}${requirement ? '+' : ''}`;
  return `<span class="mastery-value"><img class="mastery-icon" src="/mastery/${rank}.png" alt="" width="28" height="28" loading="lazy" />${label}</span>`;
}
