import { accountEn, accountHi, type AccountStrings } from './customer/account.js';
import { commonEn, commonHi, type CommonStrings } from './customer/common.js';
import { errandEn, errandHi, type ErrandStrings } from './customer/errand.js';
import { findEn, findHi, type FindStrings } from './customer/find.js';
import { ordersEn, ordersHi, type OrdersStrings } from './customer/orders.js';
import { repliesEn, repliesHi, type RepliesStrings } from './customer/replies.js';

/** The customer app's copy (ADR-0042), in groups so each screen's strings stay together. */
export interface CustomerStrings
  extends
    CommonStrings,
    FindStrings,
    RepliesStrings,
    OrdersStrings,
    ErrandStrings,
    AccountStrings {}

export const customerEn: CustomerStrings = {
  ...commonEn,
  ...findEn,
  ...repliesEn,
  ...ordersEn,
  ...errandEn,
  ...accountEn,
};
export const customerHi: CustomerStrings = {
  ...commonHi,
  ...findHi,
  ...repliesHi,
  ...ordersHi,
  ...errandHi,
  ...accountHi,
};
