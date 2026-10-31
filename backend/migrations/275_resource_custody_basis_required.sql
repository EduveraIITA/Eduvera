-- PostgreSQL CHECK treats NULL as unknown, not false. A custody handover always
-- retains the concrete named-custodian or orphan-recovery authority basis.
ALTER TABLE resource_loan_receipts ADD CONSTRAINT resource_custody_basis_required
 CHECK(action<>'custody_changed' OR custody_basis IS NOT NULL);
