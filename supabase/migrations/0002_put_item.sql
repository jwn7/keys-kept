-- put_item: version 비교 + upsert를 한 트랜잭션에서. 서버에 더 높은 version이 있으면 그 행을 돌려준다 (SyncBackend.put 계약).
-- 평문은 여기에도 없다: nonce/ciphertext는 bytea, aad는 {v,id,type}뿐.
create or replace function public.put_item(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  remote public.items%rowtype;
begin
  if (p->>'user_id')::uuid <> auth.uid() then
    raise exception 'user_id mismatch';
  end if;

  select * into remote from public.items where id = (p->>'id')::uuid for update;
  if found and remote.version > (p->>'version')::int then
    return jsonb_build_object('conflict', to_jsonb(remote));
  end if;

  insert into public.items (id, user_id, type, items_key_id, nonce, ciphertext, aad, version, updated_at, deleted_at, device_id)
  values (
    (p->>'id')::uuid, auth.uid(), p->>'type', (p->>'items_key_id')::uuid,
    decode(substr(p->>'nonce', 3), 'hex'), decode(substr(p->>'ciphertext', 3), 'hex'),
    p->'aad', (p->>'version')::int, (p->>'updated_at')::timestamptz,
    nullif(p->>'deleted_at', '')::timestamptz, nullif(p->>'device_id', '')::uuid
  )
  on conflict (id) do update set
    type = excluded.type, items_key_id = excluded.items_key_id, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
    aad = excluded.aad, version = excluded.version, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
    device_id = excluded.device_id
  where public.items.user_id = auth.uid();

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.put_item(jsonb) from public;
grant execute on function public.put_item(jsonb) to authenticated;

-- Realtime이 bytea를 그대로 내보내므로 클라이언트는 알림만 받고 list(since)로 다시 읽는다.
