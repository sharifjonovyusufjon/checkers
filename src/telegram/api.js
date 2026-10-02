async function telegramApi(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.description || method);
    err.errorCode = data.error_code;
    throw err;
  }
  return data.result;
}

module.exports = { telegramApi };
