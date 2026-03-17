import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [
    admin(),
    apiKey([
      {
        configId: "admin",
        defaultPrefix: "adm_",
      },
      {
        configId: "user",
        defaultPrefix: "usr_",
      },
    ]),
  ],
});

