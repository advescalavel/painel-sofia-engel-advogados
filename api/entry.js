import fs from 'fs';
import path from 'path';

// O Bitrix24 faz POST para a URL principal do app a cada abertura (não só na
// instalação). Hospedagem estática responde 405 a POST e o iframe fica em
// branco. Esta função aceita qualquer método e serve o mesmo HTML.
export default function handler(req, res) {
  try {
    const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    console.error('Falha ao servir index.html via /api/entry:', err);
    res.status(500).send('Erro ao carregar o painel.');
  }
}
