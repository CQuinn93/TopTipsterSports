import { Linking, Platform } from 'react-native';

/** Public site — Gamemaster enquiry and web account management. */
export const ACCOUNT_MANAGE_URL = 'https://www.toptipster.ie';

export const ACCOUNT_MANAGE_HOST_LABEL = 'www.toptipster.ie';

/**
 * Store / native clients: Player & Creator upgrades are coming soon (IAP later).
 * Do not send users to the website to buy those digital plans from the app.
 */
export function isNativeStoreClient(): boolean {
  return Platform.OS !== 'web';
}

/** @deprecated Prefer isNativeStoreClient — kept for existing call sites. */
export function isAccountManagedOnWebOnly(): boolean {
  return isNativeStoreClient();
}

export const NATIVE_UPGRADES_COMING_SOON_TITLE = 'Coming soon';

export const NATIVE_UPGRADES_COMING_SOON_MESSAGE =
  'Player and Creator upgrades will be available as in-app purchases soon. You can keep playing on your current plan in the meantime.';

export const CREATE_COMP_COMING_SOON_HINT = 'Creator upgrades coming soon';

/** Gamemaster stays web-only enquiry (custom quote), not an in-app product. */
export const GAMEMASTER_WEB_ENQUIRY_MESSAGE =
  'Club and syndicate (Gamemaster) packages are arranged on the website. Visit www.toptipster.ie to enquire.';

/** Legacy aliases used by older copy — map to coming-soon messaging on native. */
export const ACCOUNT_WEB_ONLY_TITLE = NATIVE_UPGRADES_COMING_SOON_TITLE;
export const ACCOUNT_WEB_ONLY_MESSAGE = NATIVE_UPGRADES_COMING_SOON_MESSAGE;
export const CREATE_COMP_WEB_ONLY_HINT = CREATE_COMP_COMING_SOON_HINT;

export async function openAccountManageOnWeb(): Promise<void> {
  await Linking.openURL(ACCOUNT_MANAGE_URL);
}
