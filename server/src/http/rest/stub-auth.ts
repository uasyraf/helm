import type { RestMiddleware } from "./context.js";

export const stubAuthMiddleware: RestMiddleware = async (c, next) => {
  c.set("actor", {
    developerId: null,
    userSub: null,
    handle: "anonymous",
    email: null,
    isAdmin: true,
    allowedProjects: "all",
  });
  await next();
};
