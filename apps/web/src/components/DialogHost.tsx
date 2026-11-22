import { useEffect, useId, useState, type FormEvent } from 'react';
import { useUi, type DialogSpec } from '../app/ui';
import { ko } from '../i18n/ko';

/** 앱 전체에 하나. ui.confirm / ui.prompt / ui.toast가 여기 그려진다. */
export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const toasts = useUi((s) => s.toasts);
  const dismissToast = useUi((s) => s.dismissToast);
  return (
    <>
      {dialog && <Dialog key={dialog.title} spec={dialog} />}
      {toasts.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span>{t.text}</span>
              {t.action && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    dismissToast(t.id);
                    void t.action?.run();
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Dialog({ spec }: { spec: DialogSpec }) {
  const closeDialog = useUi((s) => s.closeDialog);
  const [value, setValue] = useState(spec.kind === 'prompt' ? (spec.initial ?? '') : '');
  const [show, setShow] = useState(false);
  const titleId = useId();
  const listId = useId();

  const cancel = () => {
    closeDialog();
    if (spec.kind === 'confirm') spec.resolve(false);
    else spec.resolve(null);
  };
  const cancellable = spec.kind === 'prompt' || spec.cancellable !== false;
  const ready = spec.kind === 'confirm' ? !spec.requireWord || value.trim() === spec.requireWord : spec.allowEmpty === true || value.trim() !== '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    closeDialog();
    if (spec.kind === 'confirm') spec.resolve(true);
    else spec.resolve(value);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []); // 열릴 때 1회

  const danger = spec.kind === 'confirm' && spec.danger === true;
  const needsInput = spec.kind === 'prompt' || !!spec.requireWord;
  const label = spec.kind === 'prompt' ? spec.label : (spec.requireWord ?? '');
  const isPassword = spec.kind === 'prompt' && spec.password === true;
  const suggestions = spec.kind === 'prompt' ? (spec.suggestions ?? []) : [];

  return (
    <div className="overlay center" onClick={cancellable ? cancel : undefined}>
      <form className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id={titleId}>{spec.title}</h2>
        {spec.body && <p className="dialog-body">{spec.body}</p>}
        {needsInput && (
          <div className="field">
            <label htmlFor={`${titleId}-in`}>{label}</label>
            <div className="input-wrap">
              <input
                id={`${titleId}-in`}
                type={isPassword && !show ? 'password' : 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={spec.kind === 'prompt' ? spec.placeholder : undefined}
                list={suggestions.length ? listId : undefined}
                autoComplete={isPassword ? 'new-password' : 'off'}
                autoFocus
              />
              {value && (
                <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setValue('')}>
                  ×
                </button>
              )}
              {isPassword && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                  {show ? ko.common.hide : ko.common.show}
                </button>
              )}
            </div>
            {suggestions.length > 0 && (
              <datalist id={listId}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </div>
        )}
        <div className="actions">
          {cancellable && (
            <button type="button" className="btn btn-sm" onClick={cancel} autoFocus={danger && !needsInput}>
              {ko.common.cancel}
            </button>
          )}
          <button type="submit" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ready} autoFocus={!needsInput && !danger}>
            {spec.confirmLabel ?? ko.common.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
