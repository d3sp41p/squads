import { query } from "../lib/db.js";
import { handle, HttpError } from "../lib/http.js";

// GET /api/img?id=… → a squad photo or banner. Ids are random and images never change, so cache forever.
export const GET = handle(async request => {
  const id = new URL(request.url).searchParams.get("id") || "";
  const [img] = await query("select mime, data from images where id = $1", [id]);
  if (!img) throw new HttpError(404, "Not found");
  return new Response(img.data, {
    headers: {
      "content-type": img.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});
