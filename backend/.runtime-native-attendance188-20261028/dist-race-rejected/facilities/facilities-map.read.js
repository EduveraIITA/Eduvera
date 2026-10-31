import { sql } from 'kysely';
import { facilitiesHref } from './facilities.contracts.js';
/** Shared status is deliberately an aggregate of explicit public asset reports.
 * A participant-only link never discloses a private report to another member. */
export async function readFacilitiesMapSignals(tx, school, campus, requested, personId) {
    const ids = [...new Set(requested)];
    if (!ids.length)
        return [];
    const visible = (await sql `SELECT item.id FROM campus_resource_holdings item
    WHERE item.school_id=${school}::uuid AND item.campus_id=${campus}::uuid AND item.id=ANY(${ids}::uuid[])
    AND campus_asset_is_published(item.school_id,item.campus_id,item.id)`.execute(tx)).rows.map(item => item.id);
    if (!visible.length)
        return [];
    const signals = (await sql `
    WITH evidence AS (SELECT repair.*,verified.revision AS verified_revision,verified.recorded_at AS verified_at,
      EXISTS(SELECT 1 FROM facilities_repair_receipts reopened WHERE reopened.school_id=repair.school_id AND reopened.repair_id=repair.id
       AND reopened.action='reopened' AND reopened.reopen_kind='further_work' AND reopened.revision>coalesce(verified.revision,0)) AS further_work,
      EXISTS(SELECT 1 FROM facilities_repair_receipts reopened WHERE reopened.school_id=repair.school_id AND reopened.repair_id=repair.id
       AND reopened.action='reopened' AND reopened.reopen_kind IS NULL AND reopened.revision>coalesce(verified.revision,0)) AS unknown_reopen,
      (SELECT max(receipt.recorded_at) FROM facilities_repair_receipts receipt WHERE receipt.school_id=repair.school_id
       AND receipt.repair_id=repair.id AND receipt.action IN('reported','accepted','updated','completed','verified','reopened')) AS status_at
      FROM facilities_repairs repair LEFT JOIN LATERAL(SELECT revision,recorded_at FROM facilities_repair_receipts receipt
       WHERE receipt.school_id=repair.school_id AND receipt.repair_id=repair.id AND receipt.action='verified' ORDER BY revision DESC LIMIT 1) verified ON true
      WHERE repair.school_id=${school}::uuid AND repair.holding_id=ANY(${visible}::uuid[]) AND repair.asset_impact IS NOT NULL),
    reports AS(SELECT evidence.*,CASE WHEN state='closed' THEN 'resolved' WHEN verified_revision IS NULL OR further_work THEN 'active'
      WHEN unknown_reopen THEN 'unknown' ELSE 'resolved' END AS evidence_state FROM evidence)
    SELECT holding_id,count(*) FILTER(WHERE evidence_state IN('active','unknown'))::int AS open_reports,
      count(*) FILTER(WHERE evidence_state='active')::int AS active_reports,count(*) FILTER(WHERE evidence_state='unknown')::int AS unknown_reports,
      coalesce(bool_or(asset_impact='not_working') FILTER(WHERE evidence_state='active'),false) AS not_working,
      coalesce(bool_and(state='awaiting_verification') FILTER(WHERE evidence_state='active'),false) AS awaiting,
      max(CASE WHEN evidence_state='resolved' THEN verified_at ELSE status_at END) AS updated_at,
      (array_agg(asset_impact ORDER BY coalesce(verified_at,status_at) DESC,id DESC))[1] AS latest_impact
    FROM reports GROUP BY holding_id`.execute(tx)).rows;
    const own = (await sql `
    WITH entitled AS(SELECT id,holding_id,state,revision,row_number() OVER(PARTITION BY holding_id ORDER BY updated_at DESC,id DESC) AS rank
     FROM facilities_repairs WHERE school_id=${school}::uuid AND holding_id=ANY(${visible}::uuid[])
      AND ${personId}::uuid IN(reporter_person_id,recorder_person_id,handler_person_id,verifier_person_id,coordinator_person_id))
    SELECT id,holding_id,state,revision FROM entitled WHERE rank<=3 ORDER BY holding_id,rank`.execute(tx)).rows;
    return visible.map(holdingId => {
        const signal = signals.find(item => item.holding_id === holdingId);
        return { holding_id: holdingId,
            state: !signal ? 'unknown' : signal.active_reports ? signal.awaiting && !signal.unknown_reports ? 'awaiting_verification' : 'reported_fault' : signal.unknown_reports ? 'unknown' : 'verified_resolution',
            impact: signal ? signal.active_reports ? signal.not_working ? 'not_working' : 'degraded' : signal.unknown_reports ? null : signal.latest_impact : null,
            open_reports: signal?.open_reports ?? 0, updated_at: signal ? signal.updated_at.toISOString() : null,
            repairs: own.filter(item => item.holding_id === holdingId).map(item => ({ id: item.id, state: item.state,
                revision: item.revision, target_path: facilitiesHref(item.id), action_label: 'Open repair' })) };
    });
}
//# sourceMappingURL=facilities-map.read.js.map