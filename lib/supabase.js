// Helper minimo de acesso ao Supabase via REST (PostgREST), usando fetch
// nativo -- evita depender do pacote @supabase/supabase-js (o projeto nao
// tem build step com node_modules configurado).
//
// Variaveis de ambiente necessarias no Vercel:
//   SUPABASE_URL              -> https://grxchfgnsqvmsmcjcayp.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY -> service_role key (NUNCA a anon/public key)
//
// A service_role key ignora RLS -- por isso as tabelas abaixo tem RLS
// habilitado sem nenhuma policy publica: so o back-end (com essa chave)
// consegue ler/escrever.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configuradas nas variaveis de ambiente do Vercel.'
    );
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase respondeu ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Cria ou atualiza os tokens da instalacao (upsert por member_id).
export async function upsertInstallation({
  memberId,
  domain,
  clientEndpoint,
  accessToken,
  refreshToken,
  expiresIn,
}) {
  const n = Number(expiresIn);
let expiresAt;
if (!n) {
  expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
} else if (n > 1e12) {
  // timestamp absoluto em milissegundos (ex.: BX24.getAuth() no navegador)
  expiresAt = new Date(n).toISOString();
} else if (n > 1e9) {
  // timestamp absoluto em segundos
  expiresAt = new Date(n * 1000).toISOString();
} else {
  // duração relativa em segundos (ex.: AUTH_EXPIRES do POST de instalação)
  expiresAt = new Date(Date.now() + n * 1000).toISOString();
}

  return supabaseRequest('bitrix_installations', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        member_id: memberId,
        domain: domain || null,
        client_endpoint: clientEndpoint || (domain ? `https://${domain}/rest/` : null),
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
}

export async function getInstallation(memberId) {
  const rows = await supabaseRequest(
    `bitrix_installations?member_id=eq.${encodeURIComponent(memberId)}&select=*`,
    { method: 'GET' }
  );
  return rows && rows[0] ? rows[0] : null;
}

// Grava uma linha de log de acesso -- identificacao apenas, sem gating.
export async function logAccess({ memberId, userId, userName }) {
  return supabaseRequest('bitrix_access_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([
      {
        member_id: memberId,
        user_id: userId || null,
        user_name: userName || null,
      },
    ]),
  });
}
