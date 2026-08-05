const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const code = event.queryStringParameters && event.queryStringParameters.code;
  const errorParam = event.queryStringParameters && event.queryStringParameters.error;

  if (errorParam) {
    return htmlResponse(400, `Login cancelado ou negado pelo Tiny: ${escapeHtml(errorParam)}`);
  }
  if (!code) {
    return htmlResponse(400, "Código de autorização não encontrado. Tente fazer login de novo em /api/tiny-auth.");
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return htmlResponse(500, "TINY_CLIENT_ID ou TINY_CLIENT_SECRET não configurados nas variáveis de ambiente do Netlify.");
  }

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  const redirectUri = `${proto}://${host}/api/tiny-callback`;

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let tokenResp, tokenData;
  try {
    tokenResp = await fetch("https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    tokenData = await tokenResp.json();
  } catch (err) {
    return htmlResponse(500, `Erro ao contatar o Tiny: ${escapeHtml(String(err))}`);
  }

  if (!tokenResp.ok || !tokenData.access_token) {
    return htmlResponse(400, `Erro ao obter o token do Tiny: <pre>${escapeHtml(JSON.stringify(tokenData, null, 2))}</pre>`);
  }

  try {
    const store = getStore({
      name: "tiny-tokens",
      siteID: process.env.SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    await store.setJSON("tokens", {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000
    });
  } catch (err) {
    return htmlResponse(500, `Token obtido, mas não consegui salvar: ${escapeHtml(String(err))}`);
  }

  return htmlResponse(200, "✅ Conectado ao Tiny com sucesso! Pode fechar essa aba e voltar pro app.", true);
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function htmlResponse(statusCode, message, ok) {
  return {
    statusCode,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<html><body style="font-family:sans-serif; text-align:center; padding:60px;">
      <h2>${ok ? "✅" : "⚠️"} ${message}</h2>
    </body></html>`
  };
}
