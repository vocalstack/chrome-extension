import { defineWebExtConfig } from 'wxt';

// `npm run dev` opens Chrome on a profile kept in .wxt/chrome-data (not a
// fresh one each time), so sign-in and settings outlive a restart.
export default defineWebExtConfig({
  chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
});
