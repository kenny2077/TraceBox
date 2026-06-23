export interface User {
  id: number;
  name: string;
  email: string;
}

export type AppConfig = {
  port: number;
  env: "development" | "production";
};
