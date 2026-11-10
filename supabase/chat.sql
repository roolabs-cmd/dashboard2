-- Chat feature: run this once in Supabase > SQL Editor > New query > Run.
-- Safe to run again; it only creates what's missing.
--
-- Also add these in Cloudflare > your Worker > Settings > Variables and Secrets:
--   CHAT_ADMIN_PASSWORD      (Secret)  the admin password. Only this unlocks creating chats.
--   CHAT_SECRET              (Secret)  any long random string (32+ characters). It signs logins and scrambles the
--                                      guest codes. Do not change it later, or every guest code stops working
--                                      (you would have to reset each one).
--   SUPABASE_PUBLISHABLE_KEY (Text)    Supabase > Project Settings > API Keys > "Publishable key" (sb_publishable_...).
--                                      Used only for the live (websocket) connection. Without it chat still works,
--                                      it just checks for new messages every few seconds instead of instantly.

-- One row per chat: a name, a photo, and the one guest's code (stored scrambled, never in plain text).
create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  photo       text,                          -- small image stored as a data: URL, set by the admin only
  code_hash   text not null unique,          -- HMAC of the guest's code (two chats can't share a code)
  code_ver    integer not null default 1,    -- goes up when the admin resets the code, which signs the guest out
  rt          text not null,                 -- random name of this chat's live channel
  created_at  timestamptz not null default now()
);

-- Messages are text only and are never deleted (the restrict rule also stops a chat from being deleted while it has messages).
create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references public.chats (id) on delete restrict,
  sender      text not null check (sender in ('admin', 'guest')),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_chat_id_id_idx on public.chat_messages (chat_id, id desc);
create index if not exists chat_messages_chat_sender_time_idx on public.chat_messages (chat_id, sender, created_at desc);

-- Failed login attempts, used to slow down guessing (8 misses per 15 minutes per visitor).
create table if not exists public.chat_login_attempts (
  ip_hash     text not null,
  at          timestamptz not null default now()
);
create index if not exists chat_login_attempts_ip_at_idx on public.chat_login_attempts (ip_hash, at desc);

-- Lock the new tables. With row level security on and no policies, only the Worker (which uses your
-- secret key) can read or write them. The publishable key used by the browser can't touch them.
alter table public.chats               enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.chat_login_attempts enable row level security;

-- IMPORTANT, because the chat puts the publishable key in the browser: make sure your existing tables are
-- locked the same way, so that key can never read things like your saved Google/Spotify/Sonos tokens.
-- Your Worker uses the secret key, which ignores these rules, so nothing in the dashboard changes.
alter table if exists public.google_auth    enable row level security;
alter table if exists public.spotify_auth   enable row level security;
alter table if exists public.sonos_auth     enable row level security;
alter table if exists public.calendar_prefs enable row level security;
alter table if exists public.app_settings   enable row level security;
alter table if exists public.daily_brief    enable row level security;
