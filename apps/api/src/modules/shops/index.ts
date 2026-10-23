export { findShopsWithinRadius } from './findShopsWithinRadius.js';
export type { ShopWithDistance } from './findShopsWithinRadius.js';
export { findLearnedStock } from './learnedStock.js';
export { clearDemoShopStock, countStockOf, recordStockYes } from './stockWrite.js';
export {
  confirmStockByCustomer,
  hasStockRecord,
  invalidateStockByCustomer,
  shopsToAskAgain,
} from './stockFeedback.js';
export { DOUBTFUL_AFTER_REPORTS, freshnessLabel, rankResults, stockExpiry } from './stock.js';
export type { DeliveryOffer, LearnedStockResult, QuantityHint } from './stock.js';
export { shopsRouter } from './router.js';
export type { ShopHooks } from './router.js';
export {
  countDemoSimulatedShops,
  deleteSimulatedShops,
  findShopByOwner,
  insertSimulatedShops,
  upsertDemoShop,
} from './service.js';
export type { DemoShopSpec, Shop, SimulatedShop } from './service.js';
