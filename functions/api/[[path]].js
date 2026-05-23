import { handleApiRequest } from "../../api-core.mjs";

export async function onRequest(context) {
  return handleApiRequest(context.request, context.env);
}
