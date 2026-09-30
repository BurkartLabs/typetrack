// Same-origin JSON API client. Throws {status, error}; status 0 means the server is unreachable.
// Paths may be given as "/api/me" or just "me".
function url(path) {
  if (/^\/api(\/|$|\?)/.test(path)) return path;
  return "/api/" + String(path).replace(/^\/+/, "");
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(url(path), {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw { status: 0, error: "offline" };
  }
  const text = await res.text().catch(() => "");
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = undefined; }
  }
  if (!res.ok) throw { status: res.status, error: (data && data.error) || res.statusText || "request failed" };
  if (data === undefined) throw { status: 0, error: "offline" }; // a static server answered, not the API
  return data;
}

export const get = (path) => request("GET", path);
export const post = (path, body) => request("POST", path, body === undefined ? {} : body);
export const del = (path) => request("DELETE", path);

export const api = { get, post, del };
export default api;
