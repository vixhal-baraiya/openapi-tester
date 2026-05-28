// netlify/edge-functions/inject-upload-fix.js
// Injects the Swagger 2 formData file-upload patch into the static app on Netlify.

export default async (request, context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/upload-fix.js")) {
    const tag = '<script src="/upload-fix.js"></script>\n';
    html = html.includes("</body>") ? html.replace("</body>", tag + "</body>") : html + tag;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
