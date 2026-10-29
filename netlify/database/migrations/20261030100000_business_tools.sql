CREATE TABLE oak_tool_records (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  service text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  due_date date,
  data jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oak_tool_owner_updated ON oak_tool_records(owner_id, updated_at DESC, id);
CREATE INDEX oak_tool_owner_service ON oak_tool_records(owner_id, service, status);
CREATE INDEX oak_tool_due ON oak_tool_records(owner_id, due_date);
CREATE UNIQUE INDEX oak_tool_product_sku ON oak_tool_records(owner_id, lower(data->>'sku'))
  WHERE service = 'online-store' AND coalesce(data->>'sku', '') <> '' AND status <> 'Archived';
CREATE TABLE oak_tool_events (
  id bigserial PRIMARY KEY,
  owner_id text NOT NULL,
  record_id uuid NOT NULL REFERENCES oak_tool_records(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oak_tool_event_record ON oak_tool_events(owner_id, record_id, id DESC);
CREATE TABLE oak_tool_requests (
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
CREATE TABLE oak_tool_rule_runs (
  rule_id uuid NOT NULL REFERENCES oak_tool_records(id),
  run_date date NOT NULL,
  task_id uuid NOT NULL REFERENCES oak_tool_records(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, run_date)
);
