import { create } from 'zustand';

/**
 * 앱 안 대화상자·토스트. window.confirm/prompt/alert 대신 쓴다 (DESIGN.md: 위험 동작은 확인 단계, 피드백은 텍스트).
 * 어디서든 `await ui.confirm(...)`처럼 부르고, 화면에는 <DialogHost />가 하나만 그린다.
 */
export type ConfirmOptions = {
  title: string;
  body?: string | undefined;
  confirmLabel?: string | undefined;
  /** 삭제·연결 해제처럼 되돌리기 어려운 동작: 확인 버튼을 --danger 테두리로 */
  danger?: boolean | undefined;
  /** 이 단어를 그대로 입력해야 확인 버튼이 켜진다 (계정 삭제) */
  requireWord?: string | undefined;
  /** false면 취소 버튼 없이 안내만 */
  cancellable?: boolean | undefined;
};
export type PromptOptions = {
  title: string;
  body?: string | undefined;
  label: string;
  initial?: string | undefined;
  placeholder?: string | undefined;
  password?: boolean | undefined;
  suggestions?: string[] | undefined;
  confirmLabel?: string | undefined;
  /** 빈 값도 확인 가능 (폴더 없음으로 이동) */
  allowEmpty?: boolean | undefined;
};
export type DialogSpec =
  | ({ kind: 'confirm'; resolve(v: boolean): void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve(v: string | null): void } & PromptOptions);
export type ToastAction = { label: string; run(): void | Promise<void> };
export type Toast = { id: number; text: string; action?: ToastAction | undefined };

type UiState = {
  dialog: DialogSpec | null;
  toasts: Toast[];
  closeDialog(): void;
  dismissToast(id: number): void;
};

export const useUi = create<UiState>((set) => ({
  dialog: null,
  toasts: [],
  closeDialog: () => set({ dialog: null }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const TOAST_MS = 6000;
let toastSeq = 0;

export const ui = {
  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => useUi.setState({ dialog: { kind: 'confirm', ...opts, resolve } }));
  },
  async alert(opts: Pick<ConfirmOptions, 'title' | 'body'>): Promise<void> {
    await ui.confirm({ ...opts, cancellable: false });
  },
  prompt(opts: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => useUi.setState({ dialog: { kind: 'prompt', ...opts, resolve } }));
  },
  toast(text: string, action?: ToastAction): void {
    const id = ++toastSeq;
    useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action }] }));
    setTimeout(() => useUi.getState().dismissToast(id), TOAST_MS);
  },
};
