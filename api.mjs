import { getStore } from "@netlify/blobs";
import { handle } from "./lib.mjs";

export default async (req) => {
  const store = getStore({ name: "noel-famille", consistency: "strong" });
  return handle(req, store, {
    SESSION_SECRET: process.env.SESSION_SECRET,
    FAMILY_CODE: process.env.FAMILY_CODE,
  });
};

export const config = { path: "/api/*" };
