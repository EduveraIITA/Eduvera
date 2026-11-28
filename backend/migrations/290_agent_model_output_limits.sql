ALTER TABLE agent_model_usage
  DROP CONSTRAINT agent_model_usage_max_output_tokens_check,
  ADD CHECK (max_output_tokens IN (2048, 4096, 8192));
