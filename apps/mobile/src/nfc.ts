/** Browser preview: no NFC, so the scan screen offers typing a card ID instead. */
export type NfcState = 'ready' | 'disabled' | 'unsupported';

export async function nfcState(): Promise<NfcState> {
  return 'unsupported';
}

export async function listenForCards(_onCard: (cardId: string) => void): Promise<() => void> {
  return () => undefined;
}
