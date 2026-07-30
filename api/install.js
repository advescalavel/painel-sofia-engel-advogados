import { upsertInstallation } from '../lib/supabase.js';

export default async function handler(req, res) {
  // O Bitrix24 faz POST para esta URL ("Caminho da instalacao inicial")
  // com os dados de autenticacao da instalacao (formato "simple way" de
  // apps locais com interface): DOMAIN, AUTH_ID, AUTH_EXPIRES, REFRESH_ID,
  // member_id, status. Processamos e guardamos os tokens antes de seguir
  // para a etapa de BX24.installFinish().
  if (req.method === 'POST') {
    const body = req.body || {};
    const domain = body.DOMAIN;
    const accessToken = body.AUTH_ID;
    const refreshToken = body.REFRESH_ID;
    const expiresIn = body.AUTH_EXPIRES;
    const memberId = body.member_id;

    if (memberId && accessToken && refreshToken) {
      try {
        await upsertInstallation({
          memberId,
          domain,
          accessToken,
          refreshToken,
          expiresIn,
        });
      } catch (err) {
        // Nao interrompe o handshake por causa disso: se o Supabase falhar
        // aqui, ainda assim precisamos completar o installFinish, senao
        // TODOS os usuarios (nao so o registro de tokens) ficam bloqueados.
        console.error('Falha ao salvar instalacao no Supabase:', err);
      }
    } else {
      console.warn('POST de instalacao recebido sem os campos esperados:', Object.keys(body));
    }
  }

  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <script src="https://api.bitrix24.com/b24.js"></script>
        <script>
          // Finaliza o handshake de instalacao do app (BX24.installFinish).
          // Enquanto isso nao for chamado, o Bitrix24 marca o app como
          // "nao instalado" para o portal inteiro, e usuarios comuns
          // (nao-administradores) recebem a mensagem de instalacao incompleta.
          function finalizarInstalacao() {
            if (window.BX24 && typeof window.BX24.installFinish === 'function') {
              window.BX24.installFinish();
            }
            window.location.href = "/";
          }

          if (window.BX24 && typeof window.BX24.init === 'function') {
            window.BX24.init(finalizarInstalacao);
          } else {
            // Antes isso seguia direto pro painel (fallback silencioso),
            // o que mascarava a falha: parecia "funcionar" mas o
            // installFinish nunca era chamado, e o INSTALLED nunca virava
            // true de verdade. Agora mostramos o erro em vez de escondê-lo.
            document.body.innerHTML =
              '<p style="font-family: sans-serif; padding: 24px;">' +
              'Não foi possível carregar o SDK do Bitrix24 (b24.js). ' +
              'A instalação não pôde ser concluída — tente novamente ou ' +
              'contate o suporte técnico.</p>';
          }
        </script>
      </body>
    </html>
  `);
}
