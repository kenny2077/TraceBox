-- TraceBox Unified Event Ledger Schema
-- Version: 1.0.0

-- Sessions: agent session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  agent_name TEXT NOT NULL,
  repo_path TEXT,
  branch TEXT,
  commit_before TEXT,
  commit_after TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'rolled_back')),
  trust_score INTEGER DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 100)
);

-- Events: generic event stream
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'session_start', 'session_end',
    'pre_edit_risk', 'file_change', 'tool_call',
    'secret_detected', 'policy_decision', 'test_recommendation',
    'rollback_step', 'impact_analysis', 'network_request'
  )),
  source TEXT,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  summary TEXT,
  raw_json TEXT,
  UNIQUE(session_id, sequence)
);

-- File events: file changes with before/after
CREATE TABLE IF NOT EXISTS file_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('modified', 'created', 'deleted', 'renamed')),
  before_hash TEXT,
  after_hash TEXT,
  diff_patch TEXT,
  snapshot_path TEXT,
  size_before INTEGER,
  size_after INTEGER
);

-- Tool events: MCP tool calls
CREATE TABLE IF NOT EXISTS tool_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments_redacted TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'ask', 'blocked')),
  rule_id TEXT,
  result_preview TEXT,
  duration_ms INTEGER,
  error_message TEXT
);

-- Impact events: RippleGraph semantic analysis
CREATE TABLE IF NOT EXISTS impact_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  target_file TEXT NOT NULL,
  affected_files_json TEXT,
  affected_tests_json TEXT,
  risk_factors_json TEXT,
  impact_score INTEGER DEFAULT 0 CHECK (impact_score >= 0 AND impact_score <= 100)
);

-- Secret events: DLP detections
CREATE TABLE IF NOT EXISTS secret_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  secret_type TEXT NOT NULL,
  path TEXT,
  redacted_preview TEXT,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

-- Rollback steps: undo plan
CREATE TABLE IF NOT EXISTS rollback_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL CHECK (step_type IN ('reverse_patch', 'delete_created', 'restore_deleted', 'warn_irreversible', 'package_restore')),
  target_path TEXT,
  command TEXT,
  patch_path TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed', 'skipped')),
  reversible INTEGER DEFAULT 1,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_risk ON events(risk_level);
CREATE INDEX IF NOT EXISTS idx_file_events_path ON file_events(path);
CREATE INDEX IF NOT EXISTS idx_tool_events_name ON tool_events(tool_name);
CREATE INDEX IF NOT EXISTS idx_rollback_session ON rollback_steps(session_id);

-- Views for common queries
CREATE VIEW IF NOT EXISTS session_summary AS
SELECT 
  s.id,
  s.agent_name,
  s.started_at,
  s.ended_at,
  s.status,
  s.trust_score,
  COUNT(DISTINCT e.id) as event_count,
  COUNT(DISTINCT fe.id) as file_change_count,
  COUNT(DISTINCT te.id) as tool_call_count,
  COUNT(DISTINCT CASE WHEN e.risk_level IN ('high', 'critical') THEN e.id END) as high_risk_count
FROM sessions s
LEFT JOIN events e ON s.id = e.session_id
LEFT JOIN file_events fe ON e.id = fe.event_id
LEFT JOIN tool_events te ON e.id = te.event_id
GROUP BY s.id;

CREATE VIEW IF NOT EXISTS high_risk_events AS
SELECT e.*, s.agent_name, s.repo_path
FROM events e
JOIN sessions s ON e.session_id = s.id
WHERE e.risk_level IN ('high', 'critical')
ORDER BY e.ts DESC;
