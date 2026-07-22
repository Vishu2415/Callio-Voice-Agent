-- Antigravity Automated Programmatic Database Backup
-- Date: 2026-06-26T10:28:08.030Z

-- Table: tenants
TRUNCATE TABLE tenants CASCADE;
INSERT INTO tenants (tenant_id, name, status, created_at) VALUES ('default_tenant', 'Default Tenant', 'active', '"2026-06-26T10:00:04.537Z"');
INSERT INTO tenants (tenant_id, name, status, created_at) VALUES ('admin', 'System Admin', 'active', '"2026-06-26T10:00:04.767Z"');
INSERT INTO tenants (tenant_id, name, status, created_at) VALUES ('test_tenant', 'Test Tenant Account', 'active', '"2026-06-26T10:00:04.770Z"');
INSERT INTO tenants (tenant_id, name, status, created_at) VALUES ('saas_tenant_777', 'SaaS Customer LLC', 'active', '"2026-06-26T10:28:05.783Z"');

-- Table: tenant_wallets
TRUNCATE TABLE tenant_wallets CASCADE;
INSERT INTO tenant_wallets (tenant_id, balance, currency, updated_at) VALUES ('default_tenant', '100.0000', 'USD', '"2026-06-26T10:20:44.009Z"');
INSERT INTO tenant_wallets (tenant_id, balance, currency, updated_at) VALUES ('saas_tenant_777', '9.4870', 'USD', '"2026-06-26T10:28:06.001Z"');

-- Table: wallet_ledger
TRUNCATE TABLE wallet_ledger CASCADE;
INSERT INTO wallet_ledger (ledger_id, tenant_id, amount, transaction_type, reference_id, created_at) VALUES ('led_promo_1782469685787_4qneh', 'saas_tenant_777', '5.0000', 'promo', 'welcome_bonus', '"2026-06-26T10:28:05.783Z"');
INSERT INTO wallet_ledger (ledger_id, tenant_id, amount, transaction_type, reference_id, created_at) VALUES ('led_admin_1782469685969_6u5tc', 'saas_tenant_777', '-5.0000', 'call_debit', 'manual_drain', '"2026-06-26T10:28:05.969Z"');
INSERT INTO wallet_ledger (ledger_id, tenant_id, amount, transaction_type, reference_id, created_at) VALUES ('led_admin_1782469685986_dp37z', 'saas_tenant_777', '10.0000', 'topup', 'test_topup', '"2026-06-26T10:28:05.986Z"');
INSERT INTO wallet_ledger (ledger_id, tenant_id, amount, transaction_type, reference_id, created_at) VALUES ('led_debit_1782469686001_x68rd', 'saas_tenant_777', '-0.5130', 'call_debit', 'call_1782469685991_xyyzpfcfb', '"2026-06-26T10:28:06.001Z"');

-- Table: tenant_users
TRUNCATE TABLE tenant_users CASCADE;
INSERT INTO tenant_users (user_id, tenant_id, email, password_hash, role, created_at) VALUES ('usr_1782469685841_q5gqa', 'saas_tenant_777', 'admin@saas777.com', '4150f22c96e6df0748d1e37b087148fa:bed0ad0bf455aa5a10f69bcd8bad60ab45d3c907fc78b9829015dabca8dd4218ec723d1641c810db1e354b4a94b6e39774d122e86b28708b3d86f68a3f2440f1', 'admin', '"2026-06-26T10:28:05.783Z"');

-- Table: api_keys
TRUNCATE TABLE api_keys CASCADE;
INSERT INTO api_keys (key_id, tenant_id, secret_hash, name, status, created_at, last_used_at) VALUES ('key_admin_123', 'admin', '307466c1c057eb60853579ee4b75db49e42d3f3a195ec2436cc04f6961f9e433', 'Admin Key', 'active', '"2026-06-26T10:00:04.771Z"', '"2026-06-26T10:28:05.986Z"');
INSERT INTO api_keys (key_id, tenant_id, secret_hash, name, status, created_at, last_used_at) VALUES ('key_1782469685842_j3okf', 'saas_tenant_777', '057b84cdb192724449d2c075d369fc48a6c4a3d225b085f1cd9543a65c1174e9', 'Default Admin Key', 'active', '"2026-06-26T10:28:05.783Z"', '"2026-06-26T10:28:05.991Z"');
INSERT INTO api_keys (key_id, tenant_id, secret_hash, name, status, created_at, last_used_at) VALUES ('key_tenant_123', 'test_tenant', '0a0810332be1875c8a985c05aac5cb06d2fb413925c184ce24c96795a2b08456', 'Test Tenant Key', 'active', '"2026-06-26T10:00:04.774Z"', '"2026-06-26T10:06:07.861Z"');

-- Table: numbers
TRUNCATE TABLE numbers CASCADE;
INSERT INTO numbers (phone_number, tenant_id, provider, provider_config, status, created_at) VALUES ('+1234567890', 'test_tenant', 'freeswitch', '{"voice":"Aoede","systemInstruction":"You are a helpful customer service representative."}', 'active', '"2026-06-26T10:20:44.664Z"');
INSERT INTO numbers (phone_number, tenant_id, provider, provider_config, status, created_at) VALUES ('+1987654321', 'test_tenant', 'vobiz', '{"voice":"Kore","systemInstruction":"You are an aggressive sales assistant."}', 'active', '"2026-06-26T10:00:04.777Z"');

-- Table: calls
TRUNCATE TABLE calls CASCADE;
INSERT INTO calls (call_id, tenant_id, provider, to_phone, customer_name, status, transcript, summary, recording_url, recording_status, record_call, websocket_state, gemini_session_id, created_at, started_at, ended_at, updated_at, ai_duration_seconds, tokens_used) VALUES ('call_1782469685960_tu3fo4tlq', 'saas_tenant_777', 'freeswitch', '+1555444333', '', 'calling', '[]', '', '', 'none', false, 'disconnected', NULL, '"2026-06-26T10:28:05.961Z"', NULL, NULL, '"2026-06-26T10:28:05.962Z"', '0.0000', '{}');
INSERT INTO calls (call_id, tenant_id, provider, to_phone, customer_name, status, transcript, summary, recording_url, recording_status, record_call, websocket_state, gemini_session_id, created_at, started_at, ended_at, updated_at, ai_duration_seconds, tokens_used) VALUES ('call_1782469685991_xyyzpfcfb', 'saas_tenant_777', 'mock', '+1555444333', '', 'active', '[]', '', '', 'none', true, 'disconnected', NULL, '"2026-06-26T10:28:05.991Z"', '"2026-06-26T10:28:05.991Z"', NULL, '"2026-06-26T10:28:06.032Z"', '120.0000', '{"totalTokens":15000}');

-- Table: billing_events
TRUNCATE TABLE billing_events CASCADE;
INSERT INTO billing_events (event_id, tenant_id, call_id, event_type, quantity, amount, details, created_at) VALUES ('evt_call_1782469685994_xkohi', 'saas_tenant_777', 'call_1782469685991_xyyzpfcfb', 'call_minutes', '1.0000', '0.0130', '{"rate":0.013,"duration_seconds":0.003}', '"2026-06-26T10:28:05.995Z"');
INSERT INTO billing_events (event_id, tenant_id, call_id, event_type, quantity, amount, details, created_at) VALUES ('evt_ai_1782469685994_mtsbr', 'saas_tenant_777', 'call_1782469685991_xyyzpfcfb', 'ai_minutes', '2.0000', '0.1000', '{"rate":0.05,"ai_duration_seconds":120}', '"2026-06-26T10:28:05.998Z"');
INSERT INTO billing_events (event_id, tenant_id, call_id, event_type, quantity, amount, details, created_at) VALUES ('evt_tokens_1782469685994_ok2e1', 'saas_tenant_777', 'call_1782469685991_xyyzpfcfb', 'token_usage', '15000.0000', '0.3000', '{"rate":0.00002,"tokens":{"totalTokens":15000}}', '"2026-06-26T10:28:05.999Z"');
INSERT INTO billing_events (event_id, tenant_id, call_id, event_type, quantity, amount, details, created_at) VALUES ('evt_rec_1782469685994_u4ocv', 'saas_tenant_777', 'call_1782469685991_xyyzpfcfb', 'recording_charge', '1.0000', '0.1000', '{"rate":0.1,"status":"none"}', '"2026-06-26T10:28:06.000Z"');

-- Table: webhook_configs
TRUNCATE TABLE webhook_configs CASCADE;
INSERT INTO webhook_configs (webhook_id, tenant_id, url, events, secret_token, status, created_at) VALUES ('web_test_123', 'saas_tenant_777', 'http://127.0.0.1:5050/api/mock-webhook-target', '["call.started","call.ended","call.summary_completed"]', 'webhook_secret_999', 'active', '"2026-06-26T10:28:05.918Z"');

-- Table: webhook_deliveries
TRUNCATE TABLE webhook_deliveries CASCADE;
INSERT INTO webhook_deliveries (delivery_id, webhook_id, event_type, payload, response_status, response_body, created_at) VALUES ('dlv_1782469686004_hyvq7', 'web_test_123', 'call.ended', '{"to":"+1555444333","callId":"call_1782469685991_xyyzpfcfb","status":"completed","endedAt":"2026-06-26T10:28:05.994Z","provider":"mock","tenantId":"saas_tenant_777","startedAt":"2026-06-26T10:28:05.991Z","tokensUsed":{"totalTokens":15000},"aiDurationSeconds":120}', 404, '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/mock-webhook-target</pre>
</body>
</html>
', '"2026-06-26T10:28:06.014Z"');
INSERT INTO webhook_deliveries (delivery_id, webhook_id, event_type, payload, response_status, response_body, created_at) VALUES ('dlv_1782469686007_xnvai', 'web_test_123', 'call.summary_completed', '{"to":"+1555444333","callId":"call_1782469685991_xyyzpfcfb","status":"completed","endedAt":"2026-06-26T10:28:05.994Z","summary":"No conversation occurred during the call.","provider":"mock","tenantId":"saas_tenant_777","startedAt":"2026-06-26T10:28:05.991Z","transcript":[]}', 404, '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/mock-webhook-target</pre>
</body>
</html>
', '"2026-06-26T10:28:06.015Z"');

-- Table: audit_logs
TRUNCATE TABLE audit_logs CASCADE;
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469456660_s3mpr', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":-5,"targetTenantId":"saas_tenant_777","transaction_type":"call_debit"}', NULL, '"2026-06-26T10:24:16.670Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469456675_2obvh', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":10,"targetTenantId":"saas_tenant_777","transaction_type":"topup"}', NULL, '"2026-06-26T10:24:16.684Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469648449_f17fy', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":-5,"targetTenantId":"saas_tenant_777","transaction_type":"call_debit"}', NULL, '"2026-06-26T10:27:28.450Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469648460_ydggv', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":10,"targetTenantId":"saas_tenant_777","transaction_type":"topup"}', NULL, '"2026-06-26T10:27:28.461Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469685844_jz62r', 'saas_tenant_777', 'usr_1782469685841_q5gqa', 'tenant_registered', 'tenants', 'saas_tenant_777', '{"email":"admin@saas777.com"}', NULL, '"2026-06-26T10:28:05.783Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469685915_gnkzx', 'saas_tenant_777', 'usr_1782469685841_q5gqa', 'user_login', NULL, NULL, '{"email":"admin@saas777.com"}', NULL, '"2026-06-26T10:28:05.917Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469685972_aj3d2', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":-5,"targetTenantId":"saas_tenant_777","transaction_type":"call_debit"}', NULL, '"2026-06-26T10:28:05.973Z"');
INSERT INTO audit_logs (log_id, tenant_id, actor_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES ('aud_1782469685987_twgka', 'admin', 'admin_api', 'admin_wallet_adjustment', 'wallets', 'saas_tenant_777', '{"amount":10,"targetTenantId":"saas_tenant_777","transaction_type":"topup"}', NULL, '"2026-06-26T10:28:05.988Z"');

