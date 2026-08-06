import {
  AlertCircle,
  ArrowLeftRight,
  Banknote,
  CreditCard,
  FolderOpen,
  GitBranch,
  Landmark,
  Link2,
  PiggyBank,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
  ShoppingBasket,
  Smartphone,
  Tag,
  TrendingDown,
  TrendingUp,
  Unlink,
} from 'lucide-react';

export const GROUP_ICON_CONFIG = {
  Income: { Icon: TrendingUp, className: 'text-green-600' },
  Expense: { Icon: TrendingDown, className: 'text-red-600' },
  Transfers: { Icon: ArrowLeftRight, className: 'text-violet-500' },
  'Income Exceptions': { Icon: AlertCircle, className: 'text-amber-600' },
  'Expense Exceptions': { Icon: AlertCircle, className: 'text-amber-600' },
};

const SUBCATEGORY_TONE = {
  Income: 'text-green-500',
  Expense: 'text-red-500',
  Transfers: 'text-violet-500',
  'Income Exceptions': 'text-amber-500',
  'Expense Exceptions': 'text-amber-500',
};

export function getGroupIconConfig(groupName) {
  return GROUP_ICON_CONFIG[groupName] || { Icon: FolderOpen, className: 'text-slate-400' };
}

/** One stable icon per value of the export's `Spending Group` column. */
const SPENDING_GROUP_ICON_CONFIG = {
  'Day-to-day': { Icon: ShoppingBasket, className: 'text-sky-500' },
  Recurring: { Icon: RefreshCw, className: 'text-teal-500' },
  Debt: { Icon: CreditCard, className: 'text-rose-500' },
  Insurance: { Icon: ShieldCheck, className: 'text-indigo-500' },
  Communications: { Icon: Smartphone, className: 'text-cyan-500' },
  'Bank Fees': { Icon: Landmark, className: 'text-slate-500' },
  'Invest-save-repay': { Icon: PiggyBank, className: 'text-emerald-500' },
  Income: { Icon: Banknote, className: 'text-green-600' },
  Transfer: { Icon: ArrowLeftRight, className: 'text-violet-500' },
  Exceptions: { Icon: AlertCircle, className: 'text-amber-600' },
};

export function getSpendingGroupIconConfig(name) {
  return SPENDING_GROUP_ICON_CONFIG[name] || { Icon: FolderOpen, className: 'text-slate-400' };
}

export function getSubcategoryIconConfig(parentGroupName, subName) {
  if (subName === 'Unmatched single leg') {
    return { Icon: Unlink, className: 'text-slate-400' };
  }
  return { Icon: Tag, className: SUBCATEGORY_TONE[parentGroupName] || 'text-slate-400' };
}

export const DESCRIPTION_ICON = { Icon: Receipt, className: 'text-slate-400' };
export const EXCEPTION_DESCRIPTION_ICON = { Icon: AlertCircle, className: 'text-amber-500' };
export const VARIANT_ICON = { Icon: GitBranch, className: 'text-slate-400' };
export const TRANSFER_MATCH_ICON = { Icon: Link2, className: 'text-violet-400' };
export const NET_TOTAL_ICON = { Icon: Scale, className: 'text-slate-300' };

export function RowIcon({ config, size = 14 }) {
  if (!config) return null;
  const { Icon, className } = config;
  return <Icon size={size} className={`shrink-0 ${className}`} aria-hidden />;
}
