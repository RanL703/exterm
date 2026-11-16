/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRAINER_HOST: string;
  readonly VITE_TRAINER_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}