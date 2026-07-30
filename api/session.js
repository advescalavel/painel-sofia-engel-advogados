import { upsertInstallation, logAccess } from '../lib/supabase.js';

// Chamado pelo front-end (app.js) logo apos BX24.init(), toda vez que o
// painel abre, com os tokens que a propria sessao Bitrix do usuario ja
// forneceu via BX24.getAuth().
//
// O que este endpoint faz:
//   1. Valida o access_token direto com o Bitrix24 (user.current) --
//      nao confia em nome/ID de usuario que o navegador possa enviar.
//   2. Atualiza os tokens da instalacao no Supabase (mantem frescos).
//   3. Grava um registro de acesso (so identificacao/log, sem gating --
//      todo usuario autenticado continua vendo e filtrando tudo).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { memberId, domain, accessToken, refreshToken, expiresIn } = req.body || {};

  if (!memberId || !domain || !accessToken || !refreshToken) {
    res.status(400).json({ error: 'Dados de autenticacao incompletos.' });
    return;
  }

  try {
    const userRes = await fetch(
      `https://${domain}/rest/user.current.json?auth=${encodeURIComponent(accessToken)}`
    );
    const userData = await userRes.json();

    if (userData.error) {
      res.status(401).json({ error: 'Token invalido ou expirado.' });
      return;
    }

    const user = userData.result || {};

    await upsertInstallation({
      memberId,
      domain,
      accessToken,
      refreshToken,
      expiresIn,
    });

    await logAccess({
      memberId,
      userId: user.ID ? String(user.ID) : null,
      userName: `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() || null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro ao registrar sessao:', err);
    res.status(500).json({ error: 'Falha ao registrar sessao.' });
  }
}
