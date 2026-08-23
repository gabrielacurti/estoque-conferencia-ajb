// Lê o histórico salvo pela function agendada (tiny-pedidos-cron.js) e permite
// reabrir um pedido específico.
//
// GET  /api/tiny-historico?data=YYYY-MM-DD          -> lista os pedidos daquele dia
// GET  /api/tiny-historico?dataInicial=X&dataFinal=Y -> lista vários dias
// POST /api/tiny-historico  { data, chaveItem, reaberto: true|false } -> marca reaberto
const { getStore } = require("@netlify/blobs");

function historicoStore() {
  return getStore({
    name: "tiny-historico",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

exports.handler = async (event) => {
  const store = historicoStore();

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return jsonResponse(400, { error: "Corpo inválido, esperado JSON." });
    }
    const { data, chaveItem, reaberto } = body;
    if (!data || !chaveItem) {
      return jsonResponse(400, { error: "Informe data e chaveItem no corpo." });
    }
    const chave = `dia:${data}`;
    const registro = await store.get(chave, { type: "json" });
    if (!registro || !registro.pedidos || !registro.pedidos[chaveItem]) {
      return jsonResponse(404, { error: "Item não encontrado no histórico." });
    }
    registro.pedidos[chaveItem].reaberto = !!reaberto;
    registro.pedidos[chaveItem].reabertoEm = reaberto ? new Date().toISOString() : null;
    await store.setJSON(chave, registro);
    return jsonResponse(200, { ok: true, item: registro.pedidos[chaveItem] });
  }

  const params = event.queryStringParameters || {};
  let datas = [];
  if (params.data) {
    datas = [params.data];
  } else if (params.dataInicial && params.dataFinal) {
    datas = listarDatasEntre(params.dataInicial, params.dataFinal);
  } else {
    return jsonResponse(400, { error: "Informe ?data=YYYY-MM-DD ou ?dataInicial=X&dataFinal=Y." });
  }

  const dias = [];
  for (const data of datas) {
    const registro = await store.get(`dia:${data}`, { type: "json" });
    if (registro) dias.push(registro);
  }

  return jsonResponse(200, { dias });
};

function listarDatasEntre(inicio, fim) {
  const datas = [];
  let atual = new Date(inicio + "T00:00:00Z");
  const fimData = new Date(fim + "T00:00:00Z");
  let seguranca = 0;
  while (atual <= fimData && seguranca < 60) {
    datas.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
    seguranca++;
  }
  return datas;
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
