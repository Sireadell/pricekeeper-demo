// ============================================================
//  wholesale.js — Barrel file
//  Re-exports everything from the sub-modules so app.js
//  and any HTML onclick only needs to import from here.
// ============================================================

export {
  initTradeTab,
  populateTradeCustSelect,
  tradeSearch,
  renderTradeItems,
  toggleItemChips,
  addChip,
  addPcs,
  removeCartRow,
  toggleCartPanel,
  saveTrade,
  renderRecentTrades,
  toggleRecentTrades,
} from './trade.js';

export {
  populateWsMonths,
  toggleWsStats,
  renderWholesale,
  deleteSale,
} from './history.js';

export {
  openCustModal,
  editCustomer,
  saveCustomerRecord,
  deleteCustomer,
} from './customers.js';
