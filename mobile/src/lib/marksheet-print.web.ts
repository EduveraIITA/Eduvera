/** Reserve a blank print window in the click gesture, before authenticated source reads. */
export function prepareMarksheetPrint(_savePdf = false): { print(html: string, assertCurrent: () => void): Promise<void>; cancel(): void } {
  const popup = window.open('', '_blank', 'popup,width=860,height=1050');
  if (!popup) throw new Error('Allow this site to open the marksheet print window, then try again.');
  popup.opener = null;
  const close = () => { if (!popup.closed) popup.close(); };
  return { cancel: close, async print(html, assertCurrent) {
    assertCurrent(); if (popup.closed) throw new Error('The marksheet print window was closed.');
    popup.document.open(); popup.document.write(html); popup.document.close();
    return new Promise<void>((resolve, reject) => {
      let complete = false; const done = () => { if (complete) return; complete = true; close(); resolve(); };
      popup.addEventListener('afterprint', done, { once: true }); popup.addEventListener('beforeunload', done, { once: true });
      try { assertCurrent(); popup.focus(); popup.print(); } catch (cause) { complete = true; close(); reject(cause); }
    });
  } };
}
