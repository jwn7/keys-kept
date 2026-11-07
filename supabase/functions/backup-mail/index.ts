// Edge Function: 클라이언트가 만든 age 백업 파일을 사용자 메일로 보낸다 (SPEC §4, Pro).
// 서버는 age 파일을 열 수 없다. 40MB 초과면 Storage에 올리고 7일 서명 URL을 메일에 넣는다.
//
// 배포: supabase functions deploy backup-mail
// 비밀: supabase secrets set RESEND_API_KEY=... BACKUP_FROM="Vault <backup@yourdomain>"
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_ATTACH = 40 * 1024 * 1024;
const BUCKET = 'backups';
const SIGNED_URL_TTL = 7 * 24 * 60 * 60;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const auth = req.headers.get('authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user?.email) return new Response('unauthorized', { status: 401 });
  const user = userData.user;

  const form = await req.formData();
  const file = form.get('file');
  const to = String(form.get('to') ?? user.email);
  if (!(file instanceof File) || !file.name.endsWith('.age')) return new Response('file (.age) required', { status: 400 });
  // age 헤더 검사: 평문이 실수로 올라오는 것을 막는다.
  const head = new TextDecoder().decode(new Uint8Array(await file.slice(0, 21).arrayBuffer()));
  if (head !== 'age-encryption.org/v1') return new Response('not an age file', { status: 400 });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('BACKUP_FROM') ?? 'Vault <onboarding@resend.dev>';
  if (!resendKey) return new Response('RESEND_API_KEY not set', { status: 500 });

  let html = `<p>Vault 백업 파일 <b>${file.name}</b> (${(file.size / 1024 / 1024).toFixed(1)} MB)입니다.</p>
<p>앱이 없어도 <code>age -d ${file.name}</code> 으로 풀 수 있습니다. 백업 비밀번호는 메일에 없습니다.</p>`;
  const attachments: { filename: string; content: string }[] = [];

  if (file.size <= MAX_ATTACH) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    attachments.push({ filename: file.name, content: base64(bytes) });
  } else {
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await service.storage.from(BUCKET).upload(path, file, { contentType: 'application/octet-stream' });
    if (upErr) return new Response(`storage: ${upErr.message}`, { status: 500 });
    const { data: signed, error: signErr } = await service.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (signErr || !signed) return new Response('sign url failed', { status: 500 });
    html += `<p>파일이 40MB를 넘어 첨부 대신 7일간 유효한 링크를 보냅니다: <a href="${signed.signedUrl}">${file.name}</a></p>`;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `[Vault] 백업 ${file.name}`, html, attachments }),
  });
  if (!res.ok) return new Response(`resend: ${await res.text()}`, { status: 502 });
  return Response.json({ ok: true, attached: attachments.length > 0 });
});

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
