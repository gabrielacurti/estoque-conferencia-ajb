// Busca os pedidos do dia (ou intervalo pedido) e, pra cada um, busca o detalhe
// com os produtos vendidos (SKU, quantidade). Devolve uma lista "achatada",
// uma linha por produto vendido, pronta pra alimentar o app direto.
//
// Acesse /api/tiny-pedidos (aceita ?dataInicial=YYYY-MM-DD&dataFinal=YYYY-MM-DD,
// senão usa hoje pros dois).
const { getValidAccessToken } = require("./tiny-token-helper");

exports.handler = async (event) => {
  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    return jsonResponse(401, {
      error: "Não foi possível obter um token válido do Tiny.",
      detail: String((err && err.message) || err)
    });
  }

  const params = event.queryStringParameters || {};
  const hoje = hojeBrasil();
  const dataInicial = params.dataInicial || hoje;
  const dataFinal = params.dataFinal || hoje;

  const listUrl = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
  listUrl.searchParams.set("dataInicial", dataInicial);
  listUrl.searchParams.set("dataFinal", dataFinal);
  listUrl.searchParams.set("limit", params.limit || "100");
  listUrl.searchParams.set("offset", params.offset || "0");

  let listResp, listData;
  try {
    listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    listData = await listResp.json();
  } catch (err) {
    return jsonResponse(500, { error: "Erro ao listar pedidos.", detail: String(err) });
  }
  if (!listResp.ok) {
    return jsonResponse(listResp.status, {
      error: "A API do Tiny retornou um erro ao listar pedidos.",
      detail: listData
    });
  }

  const pedidosResumo = listData.itens || [];

  const linhas = [];
  const erros = [];
  const BATCH_SIZE = 8;
  for (let i = 0; i < pedidosResumo.length; i += BATCH_SIZE) {
    const lote = pedidosResumo.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.all(
      lote.map(async (p) => {
        try {
          const detResp = await fetch(`https://api.tiny.com.br/public-api/v3/pedidos/${p.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const detData = await detResp.json();
          if (!detResp.ok) return { erro: true, idPedido: p.id, detail: detData };
          return { erro: false, pedido: detData };
        } catch (err) {
          return { erro: true, idPedido: p.id, detail: String(err) };
        }
      })
    );
    resultados.forEach((r) => {
      if (r.erro) {
        erros.push(r);
        return;
      }
      const pedido = r.pedido;
      const canal = pedido.ecommerce && pedido.ecommerce.nome ? pedido.ecommerce.nome : "";
      const numeroPedido =
        (pedido.ecommerce && pedido.ecommerce.numeroPedidoEcommerce) || pedido.numeroPedido || "";
      (pedido.itens || []).forEach((item) => {
        linhas.push({
          sku: item.produto ? item.produto.sku : "",
          descricao: item.produto ? item.produto.descricao : "",
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          numeroPedido: numeroPedido,
          canal: canal,
          dataPrevista: pedido.dataPrevista || ""
        });
      });
    });
  }

  return jsonResponse(200, {
    linhas,
    totalPedidos: pedidosResumo.length,
    erros: erros.length ? erros : undefined
  });
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(obj, null, 2)
  };
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
