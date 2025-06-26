import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://testes_owner:npg_OyqDFiTG98ls@ep-white-fog-a62162ag-pooler.us-west-2.aws.neon.tech/testes?sslmode=require&channel_binding=require",
});
