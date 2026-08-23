// Function AGENDADA: roda sozinha todo dia (ver o "schedule" configurado em
// netlify.toml), sem precisar ninguém clicar em nada. Busca os pedidos do dia
// e guarda no histórico permanente (Netlify Blobs), sem resetar o que já
// existe e sem duplicar pedido já salvo.
const { getStore } = require("@netlify/blobs");
const { getValidAccessToken } = require("./tiny-token-helper");

function historicoStore() {
  return getStore({
    name: "tiny-historico",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

exports.handler = async () => {
  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    console.error("tiny-pedidos-cron: sem token válido", err);
    return { statusCode: 200, body: "sem token válido, pulando execução" };
  }

  const hoje = hojeBrasil();
  const store = historicoStore();

  try {
    const linhas = await buscarTodosPedidosDoDia(hoje, accessToken);
    const chave = `dia:${hoje}`;
    const existente = (await store.get(chave, { type: "json" })) || { data: hoje, pedidos: {} };

    let novos = 0;
    for (const linha of linhas) {
      const chaveItem = `${linha.numeroPedido}::${linha.sku}`;
      if (!existente.pedidos[chaveItem]) {
        existente.pedidos[chaveItem] = { ...linha, reaberto: false, salvoEm: new Date().toISOString() };
        novos++;
      }
      // Se já existia, NÃO sobrescreve — o histórico preserva o que já foi
      // conferido, mesmo que os dados do Tiny mudem depois.
    }
    existente.atualizadoEm = new Date().toISOString();
    await store.setJSON(chave, existente);

    console.log(`tiny-pedidos-cron: ${novos} pedido(s) novo(s) salvos no histórico de ${hoje}`);
    return { statusCode: 200, body: `ok: ${novos} novos` };
  } catch (err) {
    console.error("tiny-pedidos-cron: erro", err);
    return { statusCode: 200, body: "erro: " + String(err) };
  }
};

// Versão simplificada de busca (sem o limite de 18s do endpoint HTTP, já que
// aqui ninguém está esperando na tela — mas ainda com um teto de segurança
// generoso pra nunca rodar pra sempre).
async function buscarTodosPedidosDoDia(data, accessToken) {
  const TETO_MS = 4 * 60 * 1000; // 4 minutos de teto de segurança
  const inicioExecucao = Date.now();
  const PAGE_SIZE = 100;

  let pedidosResumo = [];
  let offset = 0;
  while (Date.now() - inicioExecucao < TETO_MS) {
    const listUrl = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
    listUrl.searchParams.set("dataInicial", data);
    listUrl.searchParams.set("dataFinal", data);
    listUrl.searchParams.set("limit", String(PAGE_SIZE));
    listUrl.searchParams.set("offset", String(offset));
    const r = await fetchComRetry(listUrl.toString(), accessToken);
    if (r.erroFatal) break;
    const pagina = r.data.itens || [];
    pedidosResumo = pedidosResumo.concat(pagina);
    const total = r.data.paginacao ? r.data.paginacao.total : pagina.length;
    offset += PAGE_SIZE;
    if (pagina.length < PAGE_SIZE || offset >= total) break;
  }

  const linhas = [];
  for (const p of pedidosResumo) {
    if (Date.now() - inicioExecucao > TETO_MS) break;
    const r = await fetchComRetry(`https://api.tiny.com.br/public-api/v3/pedidos/${p.id}`, accessToken);
    if (r.erroFatal) continue;
    const pedido = r.data;
    const canal = pedido.ecommerce && pedido.ecommerce.nome ? pedido.ecommerce.nome : "";
    const numeroPedido =
      (pedido.ecommerce && pedido.ecommerce.numeroPedidoEcommerce) || pedido.numeroPedido || "";
    (pedido.itens || []).forEach((item) => {
      let skuFinal = item.produto ? item.produto.sku : "";
      if (!skuFinal && item.produto && item.produto.id) skuFinal = `TINY-${item.produto.id}`;
      let dataDespacho = pedido.dataPrevista || "";
      let despachoOrigem = dataDespacho ? "tiny" : "";
      if (!dataDespacho) {
        dataDespacho = estimarDespachoConservador(pedido.data);
        despachoOrigem = dataDespacho ? "estimado" : "";
      }
      linhas.push({
        sku: skuFinal,
        descricao: item.produto ? item.produto.descricao : "",
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        numeroPedido,
        canal,
        dataPedido: pedido.data || "",
        dataPrevista: pedido.dataPrevista || "",
        dataDespacho,
        despachoOrigem
      });
    });
    await new Promise((res) => setTimeout(res, 250));
  }
  return linhas;
}

async function fetchComRetry(url, accessToken, tentativa) {
  tentativa = tentativa || 1;
  const MAX_TENTATIVAS = 3;
  let resp, rawText;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    rawText = await resp.text();
  } catch (err) {
    return { erroFatal: true, error: String(err) };
  }
  if (resp.status === 429 && tentativa < MAX_TENTATIVAS) {
    await new Promise((r) => setTimeout(r, 1000 * tentativa));
    return fetchComRetry(url, accessToken, tentativa + 1);
  }
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    return { erroFatal: true, error: "resposta não-JSON" };
  }
  if (!resp.ok || !data) return { erroFatal: true, status: resp.status, error: data };
  return { data };
}

function estimarDespachoConservador(dataPedidoStr) {
  if (!dataPedidoStr || !/^\d{4}-\d{2}-\d{2}$/.test(dataPedidoStr)) return "";
  const [y, m, d] = dataPedidoStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const diaSemana = dt.getUTCDay();
  if (diaSemana === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  else if (diaSemana === 6) dt.setUTCDate(dt.getUTCDate() + 2);
  return dt.toISOString().slice(0, 10);
}

function hojeBrasil() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date());
}
