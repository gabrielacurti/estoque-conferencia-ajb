// Busca os pedidos do dia (ou intervalo pedido) e, pra cada um, busca o detalhe
// com os produtos vendidos (SKU, quantidade). Devolve uma lista "achatada",
// uma linha por produto vendido, pronta pra alimentar o app direto.
//
// Acesse /api/tiny-pedidos (aceita ?dataInicial=YYYY-MM-DD&dataFinal=YYYY-MM-DD,
// senão usa os últimos 7 dias até hoje).
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
  const dataInicial = params.dataInicial || diasAtrasBrasil(7);
  const dataFinal = params.dataFinal || hoje;

  const LIMITE_MAX_PEDIDOS = 400;
  const PAGE_SIZE = 100;
  let pedidosResumo = [];
  let offset = 0;
  while (true) {
    const listUrl = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
    listUrl.searchParams.set("dataInicial", dataInicial);
    listUrl.searchParams.set("dataFinal", dataFinal);
    listUrl.searchParams.set("limit", String(PAGE_SIZE));
    listUrl.searchParams.set("offset", String(offset));

    let listResp, listData, listRawText;
    try {
      listResp = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      listRawText = await listResp.text();
    } catch (err) {
      return jsonResponse(500, { error: "Erro ao listar pedidos (conexão).", detail: String(err) });
    }
    if (listRawText) {
      try {
        listData = JSON.parse(listRawText);
      } catch (parseErr) {
        return jsonResponse(502, {
          error: "A API do Tiny devolveu uma resposta que não é JSON válido ao listar pedidos.",
          status: listResp.status,
          detail: listRawText.slice(0, 500)
        });
      }
    }
    if (!listResp.ok || !listData) {
      return jsonResponse(listResp.status || 500, {
        error: "A API do Tiny retornou um erro ao listar pedidos.",
        detail: listData || (listRawText ? listRawText.slice(0, 500) : "(resposta vazia)")
      });
    }

    const pagina = listData.itens || [];
    pedidosResumo = pedidosResumo.concat(pagina);

    const total = listData.paginacao ? listData.paginacao.total : pagina.length;
    offset += PAGE_SIZE;
    if (pagina.length < PAGE_SIZE) break;
    if (offset >= total) break;
    if (pedidosResumo.length >= LIMITE_MAX_PEDIDOS) break;
  }
  const truncado = pedidosResumo.length >= LIMITE_MAX_PEDIDOS;
  if (truncado) pedidosResumo = pedidosResumo.slice(0, LIMITE_MAX_PEDIDOS);

  const linhas = [];
  const erros = [];
  const BATCH_SIZE = 3;
  for (let i = 0; i < pedidosResumo.length; i += BATCH_SIZE) {
    const lote = pedidosResumo.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.all(
      lote.map(async (p) => {
        try {
          const detResp = await fetch(`https://api.tiny.com.br/public-api/v3/pedidos/${p.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const rawText = await detResp.text();
          let detData = null;
          if (rawText) {
            try {
              detData = JSON.parse(rawText);
            } catch (parseErr) {
              return {
                erro: true,
                idPedido: p.id,
                status: detResp.status,
                detail: `Resposta não é JSON válido: ${rawText.slice(0, 300)}`
              };
            }
          }
          if (!detResp.ok || !detData) {
            return {
              erro: true,
              idPedido: p.id,
              status: detResp.status,
              detail: detData || (rawText ? rawText.slice(0, 300) : "(resposta vazia)")
            };
          }
          return { erro: false, pedido: detData };
        } catch (err) {
          return { erro: true, idPedido: p.id, detail: String(err) };
        }
      })
    );
    if (i + BATCH_SIZE < pedidosResumo.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
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
    periodoBuscado: { dataInicial, dataFinal },
    truncado: truncado || undefined,
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

function diasAtrasBrasil(n) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt.format(d);
}
