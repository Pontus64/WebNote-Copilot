-- 每个用户可自定义的 DeepSeek 设置；为空时回退到 Worker env 默认值。
ALTER TABLE auth_users ADD COLUMN deepseek_base_url TEXT;
ALTER TABLE auth_users ADD COLUMN deepseek_model TEXT;
ALTER TABLE auth_users ADD COLUMN deepseek_api_key TEXT;
