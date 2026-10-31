import { Share } from 'react-native';
export const externalLinkLabel = 'Share private link';
export async function sharePrivateCalendarLink(url: string) { await Share.share({ message: url }); }
