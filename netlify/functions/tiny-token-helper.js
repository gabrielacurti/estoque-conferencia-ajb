const { getStore } = require("@netlify/blobs");

function tokenStore() {
  return getStore({
    name: "tiny-tokens",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

async function getValidAccessToken() {
  const store = tokenStore();
  const tokens = await store.get("tokens", { type: "json" });

  if (!tokens || !tokens.access_token) {
    throw new Error("Nenhum token salvo ainda. Faça login em /api/tiny-auth primeiro.");
  }

  if (Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TINY_CLIENT_ID ou TINY_CLIENT_SECRET não configurados.");
  }
  if (!tokens.refresh_token) {
    throw new Error("Token expirado e não há refresh_token salvo. Faça login de novo em /api/tiny-auth.");
  }

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch("https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token
    }).toString()
  });
  const data = await resp.json();

  if (!resp.ok || !data.access_token) {
    throw new Error("Não consegui renovar o token do Tiny: " + JSON.stringify(data));
  }

  const newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000
  };
  await store.setJSON("tokens", newTokens);

  return newTokens.access_token;
}

module.exports = { getValidAccessToken };
