-- 40MB 초과 백업용 비공개 버킷. 서명 URL(7일)로만 접근. 파일은 age 암호문이다.
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
on conflict (id) do nothing;

create policy "own backups" on storage.objects
  for all using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
