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
  const hoje = new Date().toISOString().slice(0, 10);
  const dataInicial = params.dataInicial || hoje;
  const dataFinal = params.dataFinal || hoje;

  const url = new URL("https://api.tiny.com.br/public-api/v3/pedidos");
  url.searchParams.set("dataInicial", dataInicial);
  url.searchParams.set("dataFinal", dataFinal);
  if (params.situacao) url.searchParams.set("situacao", params.situacao);
  url.searchParams.set("limit", params.limit || "100");
  url.searchParams.set("offset", params.offset || "0");

  let resp, data;
  try {
    resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    data = await resp.json();
  } catch (err) {
    return jsonResponse(500, { error: "Erro ao contatar a API do Tiny.", detail: String(err) });
  }

  if (!resp.ok) {
    return jsonResponse(resp.status, { error: "A API do Tiny retornou um erro.", detail: data });
  }

  return jsonResponse(200, data);
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
