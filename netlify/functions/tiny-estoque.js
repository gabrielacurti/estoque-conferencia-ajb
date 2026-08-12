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
  const skusParam = params.skus;
  if (!skusParam) {
    return jsonResponse(400, { error: "Informe ?skus=SKU1,SKU2,SKU3 na URL." });
  }
  const skus = skusParam.split(",").map((s) => s.trim()).filter(Boolean);

  const resultados = [];
  for (const sku of skus) {
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

      const estoqueResp = await fetch(
        `https://api.tiny.com.br/public-api/v3/estoque/${idProduto}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const estoqueData = await estoqueResp.json();

      if (!estoqueResp.ok) {
        resultados.push({ sku, encontrado: true, idProduto, erro: estoqueData });
        continue;
      }

      resultados.push({
        sku,
        encontrado: true,
        idProduto,
        saldo: estoqueData.saldo,
        reservado: estoqueData.reservado,
        disponivel: estoqueData.disponivel
      });
    } catch (err) {
      resultados.push({ sku, encontrado: false, erro: String(err) });
    }
  }

  return jsonResponse(200, { resultados });
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
