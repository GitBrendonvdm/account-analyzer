import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Aurora } from './Aurora';

const MIN_LENGTH = 8;

/**
 * The door.
 *
 * Once the data lives on a server it needs one, and a single-user app needs exactly one kind: a
 * passphrase chosen the first time the app is opened, typed on every browser after that. There is
 * no username because there is no second person, and no "forgot it" link because the only honest
 * recovery is RESET_PASSPHRASE=1 on the server, which the explanation says in as many words.
 *
 * The form submits on Enter, keeps the button busy while the server thinks, and shows whatever the
 * API said went wrong in the one place a person is already looking.
 */
export function Login({ configured, onSubmit, error, busy }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState(null);

  const firstRun = !configured;

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);
    if (firstRun) {
      if (passphrase.length < MIN_LENGTH) {
        setLocalError(`Use at least ${MIN_LENGTH} characters.`);
        return;
      }
      if (passphrase !== confirm) {
        setLocalError("The two passphrases don't match.");
        return;
      }
    } else if (!passphrase) {
      setLocalError('Type your passphrase.');
      return;
    }
    onSubmit(passphrase);
  };

  const shown = localError ?? error;
  const field =
    'w-full rounded-[14px] border bg-fill px-4 py-3 text-[15px] text-label placeholder:text-label-4 focus:border-info/40 focus:outline-none';

  return (
    <div className="relative flex min-h-screen items-center justify-center px-5">
      <Aurora />
      <form onSubmit={submit} className="materialize glass relative w-full max-w-[400px] p-8 sm:p-10">
        <div className="flex items-center gap-3">
          <span
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-white"
            style={{ background: 'linear-gradient(160deg,#5e5ce6,#0a84ff)' }}
          >
            <KeyRound size={16} />
          </span>
          <span className="t-sub">Money</span>
        </div>

        <h1 className="t-title mt-7">{firstRun ? 'Choose a passphrase' : 'Welcome back'}</h1>
        <p className="t-caption mt-2 max-w-[36ch]">
          {firstRun
            ? 'It protects your transactions on the server. Anyone who knows it can read them; nobody else can.'
            : 'Your data is on the server. Type the passphrase you chose to open it.'}
        </p>

        <div className="mt-7 flex flex-col gap-3">
          <label className="block">
            <span className="t-label mb-1.5 block">Passphrase</span>
            <input
              type="password"
              autoFocus
              autoComplete={firstRun ? 'new-password' : 'current-password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={field}
              placeholder={firstRun ? `At least ${MIN_LENGTH} characters` : ''}
              disabled={busy}
            />
          </label>
          {firstRun && (
            <label className="block">
              <span className="t-label mb-1.5 block">Once more</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field}
                disabled={busy}
              />
            </label>
          )}
        </div>

        {shown && (
          <p role="alert" className="mt-4 text-[13px] text-bad">
            {shown}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="press mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-info px-4 py-3 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          {busy ? (firstRun ? 'Setting up' : 'Opening') : firstRun ? 'Set passphrase' : 'Open'}
        </button>

        {firstRun && (
          <p className="t-caption mt-5">
            There is no reset link. If it's lost, restart the server with <code className="text-label-2">RESET_PASSPHRASE=1</code> to choose again.
          </p>
        )}
      </form>
    </div>
  );
}
