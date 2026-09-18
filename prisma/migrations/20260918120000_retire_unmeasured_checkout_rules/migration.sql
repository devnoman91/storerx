-- Three checkout rules ran on hardcoded placeholder values rather than store
-- data: chk.shipping.options fired for every store, chk.payment.options was a
-- guess, and chk.tipping could never fire. They are retired, so no scan will
-- ever evaluate them again — an issue left open by one would stay on the
-- dashboard, and in the score, forever.
--
-- They were never real findings, so they are removed rather than marked
-- resolved: "resolved" means a scan confirmed a fix. Past scan snapshots in
-- "Finding" are history and are left alone.

DELETE FROM "Issue"
WHERE "ruleId" IN ('chk.shipping.options', 'chk.payment.options', 'chk.tipping');

DELETE FROM "ExplanationCache"
WHERE "ruleId" IN ('chk.shipping.options', 'chk.payment.options', 'chk.tipping');
