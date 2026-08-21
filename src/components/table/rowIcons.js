/**
 * Icon lookups for every kind of table row — data, not components.
 *
 * Kept out of the component file so Fast Refresh keeps working: a module that exports both a
 * component and plain values gets remounted rather than hot-swapped on every edit.
 */
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
  Income: { Icon: TrendingUp, className: 'text-good' },
  Expense: { Icon: TrendingDown, className: 'text-bad' },
  Transfers: { Icon: ArrowLeftRight, className: 'text-deep' },
  'Income Exceptions': { Icon: AlertCircle, className: 'text-warn' },
  'Expense Exceptions': { Icon: AlertCircle, className: 'text-warn' },
};

const SUBCATEGORY_TONE = {
  Income: 'text-good',
  Expense: 'text-bad',
  Transfers: 'text-deep',
  'Income Exceptions': 'text-warn',
  'Expense Exceptions': 'text-warn',
};

export function getGroupIconConfig(groupName) {
  return GROUP_ICON_CONFIG[groupName] || { Icon: FolderOpen, className: 'text-label-3' };
}

/** One stable icon per value of the export's `Spending Group` column. */
const SPENDING_GROUP_ICON_CONFIG = {
  'Day-to-day': { Icon: ShoppingBasket, className: 'text-info' },
  Recurring: { Icon: RefreshCw, className: 'text-mint' },
  Debt: { Icon: CreditCard, className: 'text-pink' },
  Insurance: { Icon: ShieldCheck, className: 'text-deep' },
  Communications: { Icon: Smartphone, className: 'text-mint' },
  'Bank Fees': { Icon: Landmark, className: 'text-label-2' },
  'Invest-save-repay': { Icon: PiggyBank, className: 'text-good' },
  Income: { Icon: Banknote, className: 'text-good' },
  Transfer: { Icon: ArrowLeftRight, className: 'text-deep' },
  Exceptions: { Icon: AlertCircle, className: 'text-warn' },
};

export function getSpendingGroupIconConfig(name) {
  return SPENDING_GROUP_ICON_CONFIG[name] || { Icon: FolderOpen, className: 'text-label-3' };
}

export function getSubcategoryIconConfig(parentGroupName, subName) {
  if (subName === 'Unmatched single leg') {
    return { Icon: Unlink, className: 'text-label-3' };
  }
  return { Icon: Tag, className: SUBCATEGORY_TONE[parentGroupName] || 'text-label-3' };
}

export const DESCRIPTION_ICON = { Icon: Receipt, className: 'text-label-3' };
export const EXCEPTION_DESCRIPTION_ICON = { Icon: AlertCircle, className: 'text-warn' };
export const VARIANT_ICON = { Icon: GitBranch, className: 'text-label-3' };
export const TRANSFER_MATCH_ICON = { Icon: Link2, className: 'text-deep' };
export const NET_TOTAL_ICON = { Icon: Scale, className: 'text-label-4' };
