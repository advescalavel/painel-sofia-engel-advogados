// Resolve o escopo de acesso de um usuário do Bitrix24 no Painel Vigia.
//
// Fonte da verdade: tabela painel_vigia_permissoes no Supabase.
//
//   create table painel_vigia_permissoes (
//     id             bigserial primary key,
//     member_id      text not null,
//     bitrix_user_id text not null,
//     departamento   text not null check (departamento in ('comercial','sucesso_cliente')),
//     pode_feedback  boolean not null default false,
//     criado_em      timestamptz not null default now(),
//     unique (member_id, bitrix_user_id, departamento)
//   );
//
// Fallback opcional por departamento nativo do Bitrix24 (UF_DEPARTMENT):
// mapeie os IDs em VIGIA_DEPT_MAP, ex.: {"3":"comercial","7":"sucesso_cliente"}.
// Se o usuário não estiver em nenhuma das duas fontes, ele fica sem acesso —
// o painel mostra a tela "Sem permissão de acesso".

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEPARTAMENTOS_VALIDOS = ['comercial', 'sucesso_cliente'];

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

export async function resolverDepartamentos({ memberId, userId, bitrixDepartments }) {
  let linhas = [];
  try {
    linhas = await sb(
      `painel_vigia_permissoes?member_id=eq.${encodeURIComponent(memberId)}` +
        `&bitrix_user_id=eq.${encodeURIComponent(userId)}` +
        `&select=departamento,pode_feedback`
    );
  } catch (err) {
    console.error('Falha ao ler permissões no Supabase:', err);
  }

  let departamentos = linhas
    .map((l) => l.departamento)
    .filter((d) => DEPARTAMENTOS_VALIDOS.includes(d));
  let podeDarFeedback = linhas.some((l) => l.pode_feedback);

  if (!departamentos.length) {
    const mapa = JSON.parse(process.env.VIGIA_DEPT_MAP || '{}');
    departamentos = (bitrixDepartments || [])
      .map((id) => mapa[String(id)])
      .filter((d) => DEPARTAMENTOS_VALIDOS.includes(d));
  }

  return { departamentos: [...new Set(departamentos)], podeDarFeedback };
}

// Opções do filtro "Colaborador / IA", já limitadas aos departamentos do
// usuário — o filtro nunca oferece alguém de fora do escopo dele.
export async function listarResponsaveis(departamentos) {
  const out = {};
  for (const dep of departamentos) {
    try {
      const linhas = await sb(
        `painel_vigia_responsaveis?departamento=eq.${encodeURIComponent(dep)}` +
          `&select=nome&order=tipo.asc,nome.asc`
      );
      out[dep] = linhas.map((l) => l.nome);
    } catch (err) {
      console.error('Falha ao listar responsáveis:', err);
      out[dep] = [];
    }
  }
  return out;
}
