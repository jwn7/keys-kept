-- Vault Pro 백엔드 초기 스키마. 서버는 암호문만 보관한다.
-- 적용: supabase db reset  (로컬) / supabase db push (원격)

create table if not exists public.items_keys (
  id                   uuid primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  wrapped_key          bytea not null,           -- rootKey로 감싼 itemsKey
  wrapped_key_recovery bytea not null,           -- recoveryKey로 감싼 itemsKey
  kdf                  jsonb not null,           -- {alg:'argon2id', salt, opslimit, memlimit}
  kdf_recovery         jsonb not null,
  protocol             int  not null default 1,
  created_at           timestamptz not null default now()
);

create table if not exists public.items (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null default 'note' check (type in ('note','attachment','settings')),
  items_key_id  uuid not null references public.items_keys(id),
  nonce         bytea not null,                  -- 24B
  ciphertext    bytea not null,                  -- Note JSON (XChaCha20-Poly1305)
  aad           jsonb not null,                  -- {v:1, id, type}
  version       int  not null default 1,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  device_id     uuid,
  size_bytes    int generated always as (octet_length(ciphertext)) stored
);

create index if not exists items_user_updated_idx on public.items (user_id, updated_at);

create table if not exists public.devices (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  platform      text not null,                   -- 'web' | 'windows' | 'android' | 'ios' | 'macos' | 'linux'
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- RLS: 본인 행만. anon key가 앱에 들어가도 이 정책이 전부를 지킨다.
alter table public.items_keys enable row level security;
alter table public.items      enable row level security;
alter table public.devices    enable row level security;

create policy "own items_keys" on public.items_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own items" on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own devices" on public.devices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- updated_at은 클라이언트 값(LWW 기준)이므로 서버 트리거로 덮어쓰지 않는다.

-- Realtime: items 변경 구독 (Pro)
alter publication supabase_realtime add table public.items;

-- 사용자당 용량 상한(무료 100MB 등)은 Edge Function 또는 아래 뷰로 확인
create or replace view public.my_usage as
  select user_id, count(*) as item_count, sum(size_bytes) as total_bytes
  from public.items where deleted_at is null group by user_id;

-- 계정 삭제: auth.users 삭제 시 cascade로 전부 삭제됨. 클라이언트는
-- supabase.rpc('delete_my_account') → security definer 함수에서 auth.users 삭제.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
