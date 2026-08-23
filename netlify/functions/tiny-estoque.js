// Busca, pra uma lista de SKUs, o saldo de estoque, a foto do produto e o
// custo médio real (não o preço de venda). Acesse /api/tiny-estoque?skus=A,B,C
//
// CONTINUAÇÃO: se a resposta vier com "parcial": true, ela traz "skusRestantes"
// (os SKUs que ainda faltam). Chame de novo com ?skus=<skusRestantes> pra
// continuar de onde parou — mesma lógica usada em /api/tiny-pedidos.
const { getValidAccessToken } = require("./tiny-token-helper");

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

  // MODO DIAGNÓSTICO TEMPORÁRIO: devolve o produto exatamente como o Tiny manda,
  // sem filtro nosso. Use ?rawSku=<código do produto>. Remover quando não precisar mais.
  if (params.rawSku) {
    const buscaUrl = new URL("https://api.tiny.com.br/public-api/v3/produtos");
    buscaUrl.searchParams.set("codigo", params.rawSku);
    const buscaResp = await fetch(buscaUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const buscaData = await buscaResp.json();
    if (!buscaResp.ok || !buscaData.itens || !buscaData.itens.length) {
      return jsonResponse(404, { error: "Produto não encontrado.", detail: buscaData });
    }
    const idProduto = buscaData.itens[0].id;
    const detResp = await fetch(`https://api.tiny.com.br/public-api/v3/produtos/${idProduto}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const detData = await detResp.json();
    return jsonResponse(200, {
      produtoCruDaBusca: buscaData.itens[0],
      produtoCruDoDetalhe: detData
    });
  }

  const skusParam = params.skus;
  if (!skusParam) {
    return jsonResponse(400, { error: "Informe ?skus=SKU1,SKU2,SKU3 na URL." });
  }
  // SKUs "TINY-<id>" (usados quando o Tiny não tem SKU cadastrado, ver
  // tiny-pedidos.js) não existem como código de produto — não tem o que buscar.
  const skusTodos = skusParam.split(",").map((s) => s.trim()).filter(Boolean);
  const skus = skusTodos.filter((s) => !s.startsWith("TINY-"));

  const resultados = [];
  let paradaPorTempo = false;
  let indiceParada = -1;

  for (let i = 0; i < skus.length; i++) {
    if (tempoEsgotado()) {
      paradaPorTempo = true;
      indiceParada = i;
      break;
    }
    const sku = skus[i];
    try {
      const buscaUrl = new URL("https://api.tiny.com.br/public-api/v3/produtos");
      buscaUrl.searchParams.set("codigo", sku);
      const buscaResp = await fetch(buscaUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const buscaData = await buscaResp.json();

      if (!buscaResp.ok || !buscaData.itens || !buscaData.itens.length) {
        resultados.push({ sku, encontrado: false });
        continue;
      }
      const idProduto = buscaData.itens[0].id;

      const [estoqueResp, detalheResp] = await Promise.all([
        fetch(`https://api.tiny.com.br/public-api/v3/estoque/${idProduto}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }),
        fetch(`https://api.tiny.com.br/public-api/v3/produtos/${idProduto}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      ]);
      const estoqueData = await estoqueResp.json();
      const detalheData = detalheResp.ok ? await detalheResp.json() : null;

      if (!estoqueResp.ok) {
        resultados.push({ sku, encontrado: true, idProduto, erro: estoqueData });
        continue;
      }

      resultados.push({
        sku,
        encontrado: true,
        idProduto,
        nome: (detalheData && detalheData.descricao) || buscaData.itens[0].descricao || "",
        saldo: estoqueData.saldo,
        reservado: estoqueData.reservado,
        disponivel: estoqueData.disponivel,
        foto: extrairFoto(detalheData),
        custoMedio: extrairCustoMedio(detalheData)
      });
    } catch (err) {
      resultados.push({ sku, encontrado: false, erro: String(err) });
    }
  }

  const skusRestantes = paradaPorTempo ? skus.slice(indiceParada) : [];

  return jsonResponse(200, {
    resultados,
    parcial: paradaPorTempo || undefined,
    skusRestantes: paradaPorTempo ? skusRestantes.join(",") : undefined
  });
};

// O Tiny (API v3) não documenta publicamente o formato exato desse campo.
// Tentamos várias formas conhecidas (baseadas na API v2 antiga e em
// integrações de terceiros) pra não quebrar se o formato real for diferente
// do esperado — se nada bater, devolve "" em vez de dar erro.
function extrairFoto(detalheData) {
  if (!detalheData) return "";
  const candidatos = [
    detalheData.anexos,
    detalheData.imagens,
    detalheData.imagensExternas,
    detalheData.imagens_externas
  ];
  for (const lista of candidatos) {
    if (Array.isArray(lista) && lista.length) {
      const primeiro = lista[0];
      if (typeof primeiro === "string") return primeiro;
      if (primeiro && typeof primeiro === "object") {
        if (primeiro.url) return primeiro.url;
        if (primeiro.anexo) return primeiro.anexo;
      }
    }
  }
  if (typeof detalheData.imagem === "string") return detalheData.imagem;
  return "";
}

// Idem: nome exato do campo de custo médio não documentado publicamente,
// tentamos as variações mais prováveis.
function extrairCustoMedio(detalheData) {
  if (!detalheData) return null;
  const candidatos = [
    detalheData.custoMedio,
    detalheData.precoCusto,
    detalheData.preco_custo,
    detalheData.custo
  ];
  for (const v of candidatos) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
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
