// Serve o SDK b24.js do Bitrix24 a partir do NOSSO dominio (same-origin),
// em vez do navegador da usuaria buscar direto em api.bitrix24.com.
//
// Motivo: dentro do iframe do app, alguns navegadores/redes bloqueiam ou
// retornam 403 para esse recurso de terceiro (Tracking Prevention do
// Edge, bloqueio de cookies/third-party de rede corporativa, etc.).
// Buscando o arquivo aqui no servidor (que nao sofre esse tipo de
// bloqueio) e reenviando para o navegador como um arquivo comum do nosso
// proprio dominio, esse bloqueio deixa de se aplicar.
export default async function handler(req, res) {
  try {
    const upstream = await fetch('https://api.bitrix24.com/b24.js');

    if (!upstream.ok) {
      res.status(502).send('// Falha ao buscar o SDK do Bitrix24 (upstream ' + upstream.status + ')');
      return;
    }

    const script = await upstream.text();

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Cache curto: o SDK do Bitrix pode ser atualizado do lado deles; nao
    // queremos servir uma versao presa por muito tempo, mas tambem nao
    // precisamos buscar no upstream em toda unica requisicao.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(script);
  } catch (err) {
    console.error('Erro ao proxiar b24.js:', err);
    res.status(502).send('// Erro ao buscar o SDK do Bitrix24');
  }
}
