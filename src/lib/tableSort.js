function sortDirectionMultiplier(direction) {
  return direction === 'desc' ? -1 : 1;
}

function numericValue(item, sort) {
  if (sort.key === 'avg') return Math.abs(item.avg ?? 0);
  if (sort.key === 'remaining') return Math.abs(item.expected ?? 0);
  if (sort.key.startsWith('month:')) {
    const month = sort.key.slice('month:'.length);
    return Math.abs(item.totalsByMonth?.[month] ?? item.amountsByMonth?.[month] ?? 0);
  }
  return 0;
}

function textValue(item) {
  return item.name ?? item.description ?? item.creditLabel ?? '';
}

export function compareTableItems(a, b, sort) {
  const direction = sortDirectionMultiplier(sort.direction);

  if (sort.key === 'group') {
    return textValue(a).localeCompare(textValue(b)) * direction;
  }

  const diff = numericValue(a, sort) - numericValue(b, sort);
  if (Math.abs(diff) > 0.001) return diff * direction;

  return textValue(a).localeCompare(textValue(b));
}

export function sortTableItems(items, sort) {
  if (!sort?.key) return [...items];
  return [...items].sort((a, b) => compareTableItems(a, b, sort));
}
