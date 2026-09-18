-- StoreRx fetches /cart in a fresh session, so the cart it scans is always
-- empty. Five cart rules check things themes only show once the cart has
-- items — a checkout button to put trust badges beside, express checkout,
-- upsells, a discount field, shipping progress — so on an empty cart they
-- used to report those as missing, on every store.
--
-- Those rules now report that they could not check an empty cart, which
-- means no scan will ever re-evaluate the issues they opened: left alone they
-- would stay open, and in the score, for good. Every one came from an empty
-- cart, so none is a real finding. Resolved rows are history and are kept.

DELETE FROM "Issue"
WHERE "ruleId" IN (
  'cart.shipping.bar',
  'cart.upsell',
  'cart.trust',
  'cart.discount.prominent',
  'cart.express'
)
AND "status" <> 'resolved';
