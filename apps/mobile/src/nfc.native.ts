import type { TagEvent } from 'react-native-nfc-manager';

export type NfcState = 'ready' | 'disabled' | 'unsupported';

/** Expo Go does not include the NFC module, so it is loaded only when present. */
function load() {
  try {
    return require('react-native-nfc-manager') as typeof import('react-native-nfc-manager');
  } catch {
    return null;
  }
}

export async function nfcState(): Promise<NfcState> {
  const nfc = load();
  if (!nfc) return 'unsupported';
  try {
    if (!(await nfc.default.isSupported())) return 'unsupported';
    await nfc.default.start();
    return (await nfc.default.isEnabled()) ? 'ready' : 'disabled';
  } catch {
    return 'unsupported';
  }
}

/** Reads each card's hardware ID until the returned function is called. */
export async function listenForCards(onCard: (cardId: string) => void): Promise<() => void> {
  const nfc = load();
  if (!nfc) return () => undefined;
  const { default: manager, NfcEvents } = nfc;
  manager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
    if (tag.id) onCard(tag.id.toUpperCase());
  });
  await manager.registerTagEvent();
  return () => {
    manager.setEventListener(NfcEvents.DiscoverTag, null);
    void manager.unregisterTagEvent().catch(() => undefined);
  };
}
