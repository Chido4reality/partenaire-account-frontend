// Teeth for scripts/bar-fit/customer-pick.mjs: the payment panel's "Choose customer" row no longer goes
// through pickCustomer — it only fills the search text and closes, the way a second, LOCAL customer state
// would behave. The sale's customer is never set → the probe must go red (no customer_id, top field empty).
// Applied to a COPY in the bundle (bundle.mjs `mutate`); an anchor not found exactly once fails the bundle.
const POS = /src\/pages\/POSPage\.jsx$/;
export const PICK_TEETH = [
  { file: POS, from: `className="pay-cust-row" onClick={() => pickCustomer(c)}`, to: `className="pay-cust-row" onClick={() => { setCustSearch(c.name); setPayCustOpen(false); }}` },
  { file: POS, from: `onCreated={(c) => { setShowNewCust(false); if (c) pickCustomer(c);`, to: `onCreated={(c) => { setShowNewCust(false); if (c) setCustSearch(c.name);` },
];
