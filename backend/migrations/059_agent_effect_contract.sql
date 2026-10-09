-- Persist the policy that governed each proposed or executed agent effect. This
-- keeps historical receipts interpretable if the capability catalogue changes.
ALTER TABLE agent_actions
  ADD COLUMN contract_version text NOT NULL DEFAULT '2026-10-09.1',
  ADD COLUMN effect_class text NOT NULL DEFAULT 'consequential'
    CHECK (effect_class IN ('low_impact','consequential')),
  ADD COLUMN control_mode text NOT NULL DEFAULT 'approval'
    CHECK (control_mode IN ('monitored','approval'));

COMMENT ON TABLE agent_actions IS
  'Immutable effect input and policy snapshot. Consequential effects require a fresh confirmation; monitored low-impact effects execute once with an audit receipt. Ambiguous writes are never automatically retried.';

ALTER TABLE agent_threads
  ADD COLUMN context_summary text NOT NULL DEFAULT '',
  ADD COLUMN context_summary_through_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN context_summary_updated_at timestamptz;

COMMENT ON COLUMN agent_threads.context_summary IS
  'LLM-compacted conversational goals and outcomes only; never fresh record evidence or action authority.';

CREATE INDEX agent_runs_thread_context
  ON agent_runs(thread_id, created_at, id);
