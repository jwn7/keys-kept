/** 입력이 없으면 N분 뒤 lock(). 활동 이벤트마다 타이머를 민다. */
export function startAutoLock(minutes: number, lock: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(lock, minutes * 60_000);
  };
  const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll', 'focus'];
  for (const e of events) window.addEventListener(e, reset, { passive: true });
  const onVisibility = () => {
    if (document.visibilityState === 'visible') reset();
  };
  document.addEventListener('visibilitychange', onVisibility);
  reset();
  return () => {
    if (timer) clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, reset);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
