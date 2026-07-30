import fs from 'fs';
import path from 'path';

// O Bitrix24 faz POST para a URL principal do app a cada abertura (nao so
// na instalacao) com os dados de contexto: DOMAIN, PROTOCOL, LANG,
// APP_SID (e, para o fluxo completo, tambem AUTH_ID/REFRESH_ID). Hospedagem
// estatica normalmente so responde GET/HEAD -- um POST direto no index.html
// estatico do Vercel retorna 405, o que deixa o iframe em branco para
// todo mundo (admin incluso). Esta funcao aceita qualquer metodo e serve o
// mesmo HTML.
export default function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), 'templates', 'index.html');
    const html = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    console.error('Falha ao servir index.html via /api/entry:', err);
    // Temporario: expondo o erro real para diagnostico. Depois de resolver,
    // trocar de volta para uma mensagem genérica sem detalhes internos.
    res.status(500).send(
      'Erro ao carregar o painel.\n' +
      'Detalhe: ' + err.message + '\n' +
      'cwd: ' + process.cwd()
    );
  }
}
