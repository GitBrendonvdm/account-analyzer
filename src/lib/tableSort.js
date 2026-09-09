function sortDirectionMultiplier(direction) {
  return direction === 'desc' ? -1 : 1;
}

function numericValue(item, sort) {
  if (sort.key === 'avg') return Math.abs(item.avg ?? 0);
  if (sort.key === 'remaining') return Math.abs(item.expected ?? 0);
  // Where the cycle closes for this row: so far + still expected. Kept in step with
  // components/table/forecast.js, which is the same sum for the cell that prints it.
  if (sort.key === 'forecast') {
    const months = Object.keys(item.totalsByMonth ?? item.amountsByMonth ?? {}).sort();
    const current = months[months.length - 1];
    return Math.abs((item.totalsByMonth?.[current] ?? item.amountsByMonth?.[current] ?? 0) + (item.expected ?? 0));
  }
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
