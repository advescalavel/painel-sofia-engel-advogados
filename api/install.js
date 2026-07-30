export default function handler(req, res) {
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
            // Fallback defensivo: se o SDK nao carregar, ainda assim
            // segue para o painel em vez de travar a tela.
            finalizarInstalacao();
          }
        </script>
      </body>
    </html>
  `);
}
