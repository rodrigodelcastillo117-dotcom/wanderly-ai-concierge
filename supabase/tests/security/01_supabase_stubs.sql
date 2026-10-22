GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz NOT NULL DEFAULT now(),
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, updated_at timestamptz DEFAULT now(), phone text
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, owner uuid, created_at timestamptz DEFAULT now(),
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text,
  owner uuid, owner_id text, created_at timestamptz DEFAULT now(), metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
