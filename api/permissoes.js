import crypto from 'node:crypto';
import { upsertInstallation, logAccess } from '../lib/supabase.js';
import { resolverDepartamentos, listarResponsaveis } from '../lib/permissoes.js';

// POST /api/permissoes
//
// Chamado uma vez por abertura do painel, com os tokens que a própria sessão
// Bitrix24 do usuário forneceu via BX24.getAuth().
//
// Passos:
//   1. Valida o access_token direto no Bitrix24 (user.current) — nada de
//      confiar em id/nome que o navegador mande.
//   2. Resolve os departamentos do usuário no Supabase (tabela
//      painel_vigia_permissoes) a partir do ID real do Bitrix.
//   3. Assina um scope_token curto (HMAC, 30 min) com member_id, user_id e a
//      lista de departamentos. Toda requisição de dados carrega esse token e
//      os endpoints do n8n RECUSAM (403) departamento fora do escopo — o
//      controle de acesso é efetivo, não visual.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { memberId, domain, accessToken, refreshToken, expiresIn } = req.body || {};
  if (!memberId || !domain || !accessToken) {
    res.status(400).json({ error: 'Dados de autenticação incompletos.' });
    return;
  }

  try {
    const userRes = await fetch(
      `https://${domain}/rest/user.current.json?auth=${encodeURIComponent(accessToken)}`
    );
    const userData = await userRes.json();
    if (userData.error) {
      res.status(401).json({ error: 'Token inválido ou expirado.' });
      return;
    }

    const user = userData.result || {};
    const userId = user.ID ? String(user.ID) : null;
    const nome = `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() || null;

    if (refreshToken) {
      await upsertInstallation({ memberId, domain, accessToken, refreshToken, expiresIn });
    }
    await logAccess({ memberId, userId, userName: nome });

    // departamentos: ['comercial'] | ['sucesso_cliente'] | ambos | []
    const { departamentos, podeDarFeedback } = await resolverDepartamentos({
      memberId,
      userId,
      bitrixDepartments: user.UF_DEPARTMENT || [],
    });

    if (!departamentos.length) {
      res.status(200).json({
        usuario: { id: userId, nome },
        departamentos: [],
        pode_dar_feedback: false,
      });
      return;
    }

    const scopeToken = assinarEscopo({ memberId, userId, departamentos });

    res.status(200).json({
      usuario: { id: userId, nome },
      departamentos,
      pode_dar_feedback: podeDarFeedback,
      responsaveis: await listarResponsaveis(departamentos),
      scope_token: scopeToken,
      expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Erro ao resolver permissões:', err);
    res.status(500).json({ error: 'Falha ao resolver permissões.' });
  }
}

// Formato: base64url(payload).hex(hmac) — o n8n valida com o mesmo segredo.
function assinarEscopo({ memberId, userId, departamentos }) {
  const payload = Buffer.from(
    JSON.stringify({
      m: memberId,
      u: userId,
      d: departamentos,
      exp: Math.floor(Date.now() / 1000) + 30 * 60,
    })
  ).toString('base64url');

  const assinatura = crypto
    .createHmac('sha256', process.env.VIGIA_SCOPE_SECRET)
    .update(payload)
    .digest('hex');

  return `${payload}.${assinatura}`;
}
