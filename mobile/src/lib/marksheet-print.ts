/** Private HTML is passed directly to native print; no shared workspace file is created. */
export function prepareMarksheetPrint(savePdf = false): { print(html: string, assertCurrent: () => void): Promise<void>; cancel(): void } {
  return { cancel() {}, async print(html, assertCurrent) {
    const Print = await import('expo-print'); assertCurrent();
    if (!savePdf) { await Print.printAsync({ html }); return; }
    const Sharing = await import('expo-sharing'); assertCurrent();
    if (!await Sharing.isAvailableAsync()) throw new Error('PDF sharing is unavailable on this device. Use Print instead.');
    assertCurrent(); const file = await Print.printToFileAsync({ html, base64: false });
    try { assertCurrent(); await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: '.pdf', dialogTitle: 'Save published marksheet' }); }
    finally { const { File } = await import('expo-file-system'); const temporary = new File(file.uri); if (temporary.exists) temporary.delete(); }
  } };
}
