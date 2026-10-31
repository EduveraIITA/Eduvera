export interface CampusAlertButton { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive'; isPreferred?: boolean }
export interface CampusAlertOptions { cancelable?: boolean; onDismiss?: () => void }
export interface CampusAlert { readonly id: number; readonly title: string; readonly message?: string; readonly buttons: readonly CampusAlertButton[]; readonly options: CampusAlertOptions }

/** No action runs until the person selects its exact current confirmation. */
export function createAlertQueue() {
  let sequence = 0, scope = '', queue: CampusAlert[] = [];
  const listeners = new Set<() => void>(), publish = () => listeners.forEach(listener => listener());
  const current = () => queue[0] ?? null;
  const take = (id: number) => { if (current()?.id !== id) return null; const alert = queue.shift()!; publish(); return alert; };
  return {
    current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScope(next: string) { if (scope === next) return; scope = next; queue = []; publish(); },
    alert(title: string, message?: string, buttons?: readonly CampusAlertButton[], options: CampusAlertOptions = {}) {
      queue.push({ id: ++sequence, title, message, buttons: buttons?.length ? buttons.map(button => ({ ...button })) : [{ text: 'OK' }], options: { ...options } }); publish();
    },
    choose(id: number, index: number) {
      const alert = current(); if (!alert || alert.id !== id || !Number.isSafeInteger(index) || index < 0 || index >= alert.buttons.length) return;
      take(id); alert.buttons[index]!.onPress?.();
    },
    dismiss(id: number) {
      const alert = current(); if (!alert || alert.id !== id || alert.options.cancelable === false) return;
      take(id);
      const cancel = alert.buttons.find(button => button.style === 'cancel');
      cancel?.onPress?.(); alert.options.onDismiss?.();
    },
  };
}

export const browserAlerts = createAlertQueue();
