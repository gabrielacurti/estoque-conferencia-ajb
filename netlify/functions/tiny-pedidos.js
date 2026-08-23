// Busca os pedidos do dia (ou intervalo pedido) e, pra cada um, busca o detalhe
// com os produtos vendidos (SKU, quantidade). Devolve uma lista "achatada",
// uma linha por produto vendido, pronta pra alimentar o app direto.
//
// Acesse /api/tiny-pedidos (aceita ?dataInicial=YYYY-MM-DD&dataFinal=YYYY-MM-DD,
// senão usa os últimos 2 dias até hoje).
//
// CONTINUAÇÃO: se a resposta vier com "parcial": true, ela também traz
// "proximoOffsetDetalhe". Chame a rota de novo passando esse valor em
// ?offsetDetalhe=N (mantendo as mesmas datas) pra continuar de onde parou,
// em vez de reprocessar os pedidos que já foram buscados.
const { getValidAccessToken } = require("./tiny-token-helper");

// Orçamento de tempo total da function. O plano do Netlify em uso tem limite real
// de invocação síncrona de 26s (gateway devolve 502 pro navegador se estourar,
// mesmo que a function em si continue rodando por baixo). Paramos com boa folga
// antes disso pra sempre devolver uma resposta válida (200), nunca deixar o
// gateway "matar" a chamada.
// IMPORTANTE: o cronômetro é reiniciado a cada chamada (dentro do handler), porque
// o Netlify reaproveita o mesmo container "quente" entre invocações — se o início
// ficasse fora do handler, só seria calculado uma vez na inicialização do container.
const DEADLINE_MS = 18000;

exports.handler = async (event) => {
  const INICIO_EXECUCAO = Date.now();
  function tempoEsgotado() {
    return Date.now() - INICIO_EXECUCAO > DEADLINE_MS;
  }

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

  // MODO DIAGNÓSTICO TEMPORÁRIO: devolve o pedido exatamente como o Tiny manda,
  // sem nenhum filtro/mapeamento nosso. Use ?rawNumeroPedido=<número do pedido
  // do canal, ex: 2608221K4YHXJ2> pra descobrir os nomes reais dos campos.
  // Remover depois de resolver o mapeamento de dataPrevista/sku de kits.
  if (params.rawNumeroPedido) {
    return await diagnosticoRaw(params.rawNumeroPedido, accessToken);
  }

  // MODO DIAGNÓSTICO TEMPORÁRIO 2: testa a API de Expedição (recém-liberada) de
  // várias formas pra descobrir qual endpoint/parâmetro realmente funciona.
  // Use ?rawExpedicaoIdPedido=<id interno do pedido no Tiny, ex: 895609857>.
  if (params.rawExpedicaoIdPedido) {
    return await diagnosticoExpedicao(params.rawExpedicaoIdPedido, accessToken);
  }

  // MODO DIAGNÓSTICO TEMPORÁRIO 3: testa a API de Anúncios, pra ver se ela tem
  // foto do produto. Use ?rawAnuncios=1 (lista os primeiros anúncios, sem filtro).
  if (params.rawAnuncios) {
    return await diagnosticoAnuncios(accessToken);
  }
  const hoje = hojeBrasil();
  const dataInicial = params.dataInicial || diasAtrasBrasil(2);
  const dataFinal = params.dataFinal || hoje;
  // Índice (dentro da lista de pedidos do período) de onde começar a buscar
  // detalhe. 0 = começa do zero. Usado pra continuar uma busca que parou
  // por tempo numa chamada anterior.
  const offsetDetalheInicial = Math.max(0, parseInt(params.offsetDetalhe, 10) || 0);

  const LIMITE_MAX_PEDIDOS = 400; // trava de segurança pra function não estourar o tempo
  const PAGE_SIZE = 100;
  let pedidosResumo = [];
  let offset = 0;
  let paradaPorTempoNaListagem = false;
  while (true) {
    if (tempoEsgotado()) {
      paradaPorTempoNaListagem = true;
      break;
    }
    const listUrl = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
    listUrl.searchParams.set("dataInicial", dataInicial);
    listUrl.searchParams.set("dataFinal", dataFinal);
    listUrl.searchParams.set("limit", String(PAGE_SIZE));
    listUrl.searchParams.set("offset", String(offset));

    const listResult = await fetchComRetry(listUrl.toString(), accessToken);
    if (listResult.erroFatal) {
      return jsonResponse(listResult.status || 500, {
        error: listResult.error,
        status: listResult.status,
        detail: listResult.detail
      });
    }
    const listData = listResult.data;

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
  let paradaPorTempoNoDetalhe = false;
  let proximoOffsetDetalhe = offsetDetalheInicial;
  for (let i = offsetDetalheInicial; i < pedidosResumo.length; i += BATCH_SIZE) {
    if (tempoEsgotado()) {
      paradaPorTempoNoDetalhe = true;
      break;
    }
    const lote = pedidosResumo.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.all(
      lote.map(async (p) => {
        const r = await fetchComRetry(
          `https://api.tiny.com.br/public-api/v3/pedidos/${p.id}`,
          accessToken
        );
        if (r.erroFatal) {
          return { erro: true, idPedido: p.id, status: r.status, detail: r.detail };
        }
        return { erro: false, pedido: r.data };
      })
    );
    proximoOffsetDetalhe = i + BATCH_SIZE;
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
        // Kits às vezes vêm sem SKU cadastrado no Tiny (só o id interno do
        // produto). Sem isso, a venda inteira seria descartada mais na frente
        // (o app ignora linha sem SKU). Usamos um SKU provisório baseado no id
        // do produto — o app já sabe casar kit por descrição quando o SKU não
        // bate com nada cadastrado, então a venda continua sendo contabilizada.
        let skuFinal = item.produto ? item.produto.sku : "";
        if (!skuFinal && item.produto && item.produto.id) {
          skuFinal = `TINY-${item.produto.id}`;
        }
        // Data de despacho: usamos a do Tiny quando ele tem (comum no Mercado
        // Livre); quando não tem (comum na Shopee), calculamos uma estimativa
        // conservadora com base no dia do pedido — sempre a data MAIS CEDO
        // possível dentro da regra combinada, pra nunca dar a impressão de que
        // sobra mais tempo do que realmente sobra. Como a API do Tiny só dá o
        // dia (sem hora), não dá pra saber com certeza se foi antes/depois do
        // horário de corte — por isso "estimado" pode, às vezes, mostrar uma
        // data um pouco mais cedo do que a real (nunca mais tarde).
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
          numeroPedido: numeroPedido,
          canal: canal,
          dataPedido: pedido.data || "",
          dataPrevista: pedido.dataPrevista || "",
          dataDespacho: dataDespacho,
          despachoOrigem: despachoOrigem
        });
      });
    });
  }

  // Só é parcial de verdade se sobrou trabalho: paramos a listagem no meio,
  // OU paramos o detalhe antes de cobrir todos os pedidos já listados.
  const detalheIncompleto = proximoOffsetDetalhe < pedidosResumo.length;
  const parcial = paradaPorTempoNaListagem || (paradaPorTempoNoDetalhe && detalheIncompleto);

  return jsonResponse(200, {
    linhas,
    totalPedidos: pedidosResumo.length,
    periodoBuscado: { dataInicial, dataFinal },
    truncado: truncado || undefined,
    parcial: parcial || undefined,
    proximoOffsetDetalhe: parcial ? proximoOffsetDetalhe : undefined,
    avisoParcial: parcial
      ? `A API do Tiny está lenta/limitando as chamadas agora, então paramos antes do tempo limite do servidor. Chame /api/tiny-pedidos?dataInicial=${dataInicial}&dataFinal=${dataFinal}&offsetDetalhe=${proximoOffsetDetalhe} pra continuar de onde parou.`
      : undefined,
    erros: erros.length ? erros : undefined
  });
};

async function fetchComRetry(url, accessToken, tentativa) {
  tentativa = tentativa || 1;
  const MAX_TENTATIVAS = 2;

  let resp, rawText;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    rawText = await resp.text();
  } catch (err) {
    return { erroFatal: true, error: "Erro de conexão com a API do Tiny.", detail: String(err) };
  }

  if (resp.status === 429 && tentativa < MAX_TENTATIVAS) {
    const espera = 800 * tentativa; // 800ms, depois 1.6s
    await new Promise((r) => setTimeout(r, espera));
    return fetchComRetry(url, accessToken, tentativa + 1);
  }

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      return {
        erroFatal: true,
        status: resp.status,
        error: "A API do Tiny devolveu uma resposta que não é JSON válido.",
        detail: rawText.slice(0, 500)
      };
    }
  }

  if (!resp.ok || !data) {
    return {
      erroFatal: true,
      status: resp.status,
      error:
        resp.status === 429
          ? "A API do Tiny está limitando as chamadas (muitas requisições). Tenta de novo em alguns segundos."
          : "A API do Tiny retornou um erro.",
      detail: data || (rawText ? rawText.slice(0, 500) : "(resposta vazia)")
    };
  }

  return { data };
}

async function diagnosticoRaw(numeroPedidoBuscado, accessToken) {
  // Procura nos últimos 10 dias o pedido com esse número (do canal), pega o ID
  // interno do Tiny, e devolve o detalhe cru desse pedido — sem nenhum filtro.
  const hoje = hojeBrasil();
  const dataInicial = diasAtrasBrasil(10);
  let offset = 0;
  const PAGE_SIZE = 100;
  let encontrado = null;
  let encontradoResumoLista = null;

  while (offset < 500) {
    const listUrl = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
    listUrl.searchParams.set("dataInicial", dataInicial);
    listUrl.searchParams.set("dataFinal", hoje);
    listUrl.searchParams.set("limit", String(PAGE_SIZE));
    listUrl.searchParams.set("offset", String(offset));

    const listResult = await fetchComRetry(listUrl.toString(), accessToken);
    if (listResult.erroFatal) {
      return jsonResponse(listResult.status || 500, {
        error: listResult.error,
        detail: listResult.detail
      });
    }
    const pagina = listResult.data.itens || [];
    if (!pagina.length) break;

    for (const p of pagina) {
      const detResult = await fetchComRetry(
        `https://api.tiny.com.br/public-api/v3/pedidos/${p.id}`,
        accessToken
      );
      if (detResult.erroFatal) continue;
      const pedido = detResult.data;
      const numEcom =
        (pedido.ecommerce && pedido.ecommerce.numeroPedidoEcommerce) || "";
      const num = pedido.numeroPedido || "";
      if (
        String(numEcom) === String(numeroPedidoBuscado) ||
        String(num) === String(numeroPedidoBuscado)
      ) {
        encontrado = pedido;
        encontradoResumoLista = p;
        break;
      }
    }
    if (encontrado) break;
    offset += PAGE_SIZE;
  }

  if (!encontrado) {
    return jsonResponse(404, {
      error: `Pedido com número "${numeroPedidoBuscado}" não encontrado nos últimos 10 dias.`
    });
  }
  return jsonResponse(200, { pedidoCru: encontrado, resumoListaCru: encontradoResumoLista });
}

async function diagnosticoAnuncios(accessToken) {
  const tentativas = [
    { nome: "GET /anuncios", url: `https://api.tiny.com.br/public-api/v3/anuncios?limit=3` },
    { nome: "GET /anuncio", url: `https://api.tiny.com.br/public-api/v3/anuncio?limit=3` },
    { nome: "GET /ecommerce/anuncios", url: `https://api.tiny.com.br/public-api/v3/ecommerce/anuncios?limit=3` }
  ];
  const resultados = [];
  for (const t of tentativas) {
    try {
      const resp = await fetch(t.url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const rawText = await resp.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        data = rawText.slice(0, 300);
      }
      resultados.push({ tentativa: t.nome, url: t.url, status: resp.status, resposta: data });
    } catch (err) {
      resultados.push({ tentativa: t.nome, url: t.url, erro: String(err) });
    }
  }
  return jsonResponse(200, { resultados });
}

async function diagnosticoExpedicao(idPedido, accessToken) {
  // Tenta várias formas plausíveis de consultar a API de Expedição de uma vez,
  // já que a documentação pública não deixa claro o formato exato.
  const tentativas = [
    { nome: "GET /expedicao/{id}", url: `https://api.tiny.com.br/public-api/v3/expedicao/${idPedido}` },
    { nome: "GET /expedicao?idPedido=", url: `https://api.tiny.com.br/public-api/v3/expedicao?idPedido=${idPedido}` },
    { nome: "GET /expedicao?pedido=", url: `https://api.tiny.com.br/public-api/v3/expedicao?pedido=${idPedido}` },
    { nome: "GET /expedicao (lista)", url: `https://api.tiny.com.br/public-api/v3/expedicao` }
  ];

  const resultados = [];
  for (const t of tentativas) {
    try {
      const resp = await fetch(t.url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const rawText = await resp.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        data = rawText.slice(0, 300);
      }
      resultados.push({ tentativa: t.nome, url: t.url, status: resp.status, resposta: data });
    } catch (err) {
      resultados.push({ tentativa: t.nome, url: t.url, erro: String(err) });
    }
  }
  return jsonResponse(200, { resultados });
}

// Estimativa CONSERVADORA de despacho quando o Tiny não devolve a data real
// (comum na Shopee). Regra combinada que Gabi passou:
// - Terça a sexta: venda até 13h despacha no mesmo dia; depois das 13h, no dia seguinte.
// - Sexta depois das 13h, sábado, domingo e segunda até 8h: despacham na segunda.
// - Segunda das 8h em diante (antes ou depois das 13h): despacha na terça.
// Como a API só dá o DIA do pedido (sem hora), não dá pra saber se foi antes
// ou depois do horário de corte. Por segurança ("nunca perder prazo"), sempre
// assumimos o cenário mais cedo possível dentro da regra:
// - Segunda a sexta: assume que foi antes do corte → despacha no mesmo dia.
// - Sábado ou domingo: só existe uma opção na regra → despacha na segunda seguinte.
function estimarDespachoConservador(dataPedidoStr) {
  if (!dataPedidoStr || !/^\d{4}-\d{2}-\d{2}$/.test(dataPedidoStr)) return "";
  const [y, m, d] = dataPedidoStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const diaSemana = dt.getUTCDay(); // 0=domingo, 1=segunda, ..., 6=sábado

  if (diaSemana === 0) {
    dt.setUTCDate(dt.getUTCDate() + 1); // domingo -> segunda
  } else if (diaSemana === 6) {
    dt.setUTCDate(dt.getUTCDate() + 2); // sábado -> segunda
  }
  // segunda a sexta: mantém o mesmo dia (cenário mais cedo possível)
  return dt.toISOString().slice(0, 10);
}

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
