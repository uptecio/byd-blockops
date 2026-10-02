// Embedded in APK builds; browser games normally use their own host.
export const GAME_SERVER_URL = typeof __GAME_SERVER_URL__ === 'undefined' ? '' : __GAME_SERVER_URL__;
