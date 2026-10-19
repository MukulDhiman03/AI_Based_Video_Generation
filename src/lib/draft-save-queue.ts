// A debounce may fire while a save is already running. Keep the lock until
// every newer snapshot has been sent, rather than relying on another render
// or debounce to restart the queue. saveOnce returns true only after a
// successful save that left newer edits pending.
export async function drainDraftSaveQueue(
  lock: { current: boolean },
  saveOnce: () => Promise<boolean>,
  canSave: () => boolean,
) {
  if (lock.current || !canSave()) return;
  lock.current = true;
  try {
    while (canSave()) {
      if (!(await saveOnce())) break;
    }
  } finally {
    lock.current = false;
  }
}
