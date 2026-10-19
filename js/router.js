// ============================================================
//  router.js — hash-based routing for Price Keeper
//
//  Routes:
//    #/dashboard
//    #/inventory/items
//    #/inventory/suppliers/directory
//    #/inventory/suppliers/prices
//    #/inventory/suppliers/shopping
//    #/trade
//    #/business/customers
//    #/business/insights
//    #/business/expenses
//    #/business/staff-activity
//    #/settings
//    #/storefront
//
//  Usage:
//    pushHash('inventory/suppliers/prices')  — call from navigation fns
//    initRouter(onNavigate)                  — call once after auth ready
//    currentPath()                           — read current path
// ============================================================

// True while the router is handling a hashchange — prevents navigation
// functions from writing back to location.hash and creating a loop.
export let routerNavigating = false;

export function currentPath() {
  return location.hash.replace(/^#\/?/, '') || 'dashboard';
}

export function pushHash(path) {
  if (routerNavigating) return;
  const h = '#/' + path.replace(/^[#/]+/, '');
  if (location.hash === h) return;
  location.hash = h;
}

export function initRouter(onNavigate) {
  window.addEventListener('hashchange', () => {
    routerNavigating = true;
    try { onNavigate(currentPath()); }
    finally { routerNavigating = false; }
  });
}
