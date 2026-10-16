import { accountLabel } from '../../db/accountIdentity';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { provenanceOf, useAccountDraft } from './accountBits';

const PRIMARY =
  'press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 max-md:min-h-11 max-md:flex-1';
const SECONDARY =
  'glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label max-md:min-h-11 max-md:flex-1';
const QUIET = 'press text-[12.5px] text-label-3 hover:text-label max-md:min-h-11 max-md:px-2';

/** Every control full width and at least 44px tall on a phone; the 16px type stops iOS zooming into it. */
const TOUCH_FIELD = '[&_input]:min-h-11 [&_input]:w-full [&_input]:min-w-0 [&_input]:text-base';

/**
 * One account's details, in a dialog: its name, what it holds and the day that was read, and the limit
 * or overdraft. The form is here rather than on the page so the page can stay a list you read at a
 * glance. Closing and hiding are one step away, because they are things you do to an account, not
 * fields of it.
 */
export function EditAccountModal({ account, dataThrough, todayIso, onSave, onClose, onHide, onDone }) {
  const draft = useAccountDraft({ account, onSave, dataThrough, todayIso });
  const label = accountLabel(account);
  const origin = provenanceOf(account, dataThrough);
  const limitLabel = draft.isCard ? 'Credit limit' : draft.isBank ? 'Overdraft limit' : null;

  const submit = (e) => {
    e.preventDefault();
    draft.commit();
    onDone();
  };

  return (
    <Sheet
      title={label}
      subtitle={`${account.type} · ${account.rawName}`}
      onClose={onDone}
      footer={
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="submit" form="edit-account" className={PRIMARY}>
            Save
          </button>
          <button type="button" onClick={onDone} className={SECONDARY}>
            Cancel
          </button>
          {(onClose || onHide) && (
            <span className="ml-auto flex items-center gap-1 max-md:ml-0 max-md:w-full">
              {onClose && (
                <button type="button" onClick={onClose} className={QUIET}>
                  Close this account…
                </button>
              )}
              {onHide && (
                <button type="button" onClick={onHide} className={QUIET}>
                  Hide
                </button>
              )}
            </span>
          )}
        </div>
      }
    >
      <form id="edit-account" onSubmit={submit} className={`mt-4 flex flex-col gap-4 ${TOUCH_FIELD}`}>
        <label className="flex flex-col gap-1.5">
          <span className="t-label">Name</span>
          <input
            value={draft.label}
            onChange={(e) => draft.setLabel(e.target.value)}
            placeholder={accountLabel({ rawName: account.rawName, id: account.id })}
            className="w-full rounded border bg-transparent px-2 py-1 text-sm focus:border-info/30 focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={draft.owed ? 'What you owe today' : 'What it holds today'}
            prefix={draft.owed ? 'owe R' : 'R'}
            value={draft.value}
            onChange={draft.setValue}
            placeholder="—"
            width="w-full"
            className="min-w-0"
          />
          <Field
            label="As of"
            type="date"
            inputMode="none"
            value={draft.asOf}
            onChange={draft.setAsOf}
            max={todayIso}
            width="w-full"
            className="min-w-0"
          />
          {limitLabel && (
            <Field
              label={limitLabel}
              prefix="R"
              value={draft.isCard ? draft.limit : draft.overdraft}
              onChange={draft.isCard ? draft.setLimit : draft.setOverdraft}
              placeholder={draft.isCard ? 'limit' : 'overdraft'}
              width="w-full"
              className="min-w-0"
            />
          )}
        </div>
        <p className="t-caption">
          {origin ? `Stored: ${origin.text}.` : 'No balance given yet.'} Every past cycle is re-based from this, so the day matters as
          much as the number.
          {origin?.staleDays > 60 && <span className="text-warn"> It is {origin.staleDays} days older than the data.</span>}
        </p>
      </form>
    </Sheet>
  );
}
