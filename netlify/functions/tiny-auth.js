exports.handler = async (event) => {
  const clientId = process.env.TINY_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 500,
      body: "TINY_CLIENT_ID não configurado nas variáveis de ambiente do Netlify."
    };
  }

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  const redirectUri = `${proto}://${host}/api/tiny-callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri
  });

  const authUrl = `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?${params.toString()}`;

  return {
    statusCode: 302,
    headers: { Location: authUrl }
  };
};
