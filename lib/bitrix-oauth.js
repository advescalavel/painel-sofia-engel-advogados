// Helper de renovacao de access_token via refresh_token.
// Nao e chamado automaticamente em nenhum fluxo ainda -- fica pronto para
// quando algo server-side (cron, n8n, uma rota futura) precisar chamar a
// REST API do Bitrix24 sem depender de um usuario logado no navegador.
//
// Variaveis de ambiente necessarias no Vercel:
//   BITRIX_CLIENT_ID     -> "Client ID" do app local (Recursos do
//                            desenvolvedor > Outro > seu app > OAuth 2.0)
//   BITRIX_CLIENT_SECRET -> "Client secret" do mesmo lugar

const OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/';

export async function refreshAccessToken(refreshToken) {
  const clientId = process.env.BITRIX_CLIENT_ID;
  const clientSecret = process.env.BITRIX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET nao configuradas nas variaveis de ambiente do Vercel.'
    );
  }

  const url = new URL(OAUTH_TOKEN_URL);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('refresh_token', refreshToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao renovar token Bitrix24 (${res.status}): ${text}`);
  }

  // Retorna { access_token, refresh_token, expires_in, domain, member_id, ... }
  return res.json();
}
