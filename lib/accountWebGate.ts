import { Linking, Platform } from 'react-native';

/** Public site where subscriptions and account settings are managed. */
export const ACCOUNT_MANAGE_URL = 'https://www.toptipster.ie';

export const ACCOUNT_MANAGE_HOST_LABEL = 'www.toptipster.ie';

/**
 * Store / native clients do not sell or change subscriptions in-app.
 * Web (including “Add to Home Screen”) keeps full account management.
 */
export function isAccountManagedOnWebOnly(): boolean {
  return Platform.OS !== 'web';
}

export const ACCOUNT_WEB_ONLY_TITLE = 'Manage on the web';

export const ACCOUNT_WEB_ONLY_MESSAGE =
  'Account settings and subscriptions are handled on the web app. Visit www.toptipster.ie to manage your account.';

export const CREATE_COMP_WEB_ONLY_HINT =
  'Visit www.toptipster.ie to manage your account';

export async function openAccountManageOnWeb(): Promise<void> {
  await Linking.openURL(ACCOUNT_MANAGE_URL);
}
