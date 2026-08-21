/** Renders one of the icon configs from `rowIcons.js`. */
export function RowIcon({ config, size = 14 }) {
  if (!config) return null;
  const { Icon, className } = config;
  return <Icon size={size} className={`shrink-0 ${className}`} aria-hidden />;
}
