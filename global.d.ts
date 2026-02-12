import type enUS from "./messages/en-US.json";

type Messages = typeof enUS;

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
