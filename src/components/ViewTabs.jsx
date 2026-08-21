import { BarChart3, Repeat, Table2, Target, Wallet } from 'lucide-react';

const TABS = [
  { id: 'table', label: 'Table', Icon: Table2 },
  { id: 'charts', label: 'Charts', Icon: BarChart3 },
  { id: 'habits', label: 'Habits', Icon: Repeat },
  { id: 'plan', label: 'Plan', Icon: Target },
  { id: 'accounts', label: 'Accounts', Icon: Wallet },
];

export function ViewTabs({ activeTab, onTabChange }) {
  return (
    <div className="flex gap-1 glass-tile p-1">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          aria-current={activeTab === id ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === id
              ? 'bg-fill-2 text-white'
              : 'text-label-2 hover:bg-fill'
          }`}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}
