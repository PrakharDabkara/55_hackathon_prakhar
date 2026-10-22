export {
  authOf,
  createIdentify,
  createRequireAdmin,
  createRequireAuth,
  requireRole,
} from './middleware.js';
export {
  anonymiseUser,
  createShopUsers,
  deleteUsers,
  hasLiveSession,
  lockLiveUser,
  phoneOf,
  revokeAllSessions,
  revokeSession,
} from './service.js';
export type { NewUserSession } from './service.js';
export { identityRouter } from './router.js';
export { displayPhone, maskPhone, normalisePhone } from './phone.js';
export type { AuthContext, User } from './types.js';
