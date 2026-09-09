export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;                  // fotos/documentos entrantes, de paso — ver media.ts
  JANING?: Fetcher;                 // service binding al Worker janing-portal (inbound_url = "binding:JANING")
  ENVIRONMENT: string;
  PUBLIC_URL?: string;              // base de las URLs firmadas que se dan a los portales

  // Correo. Se intenta el binding de Cloudflare primero; si no está (o el dominio
  // no está dado de alta en Email Sending) se cae a Resend. Con que exista uno basta.
  EMAIL?: { send(msg: EmailMessage): Promise<unknown> };
  RESEND_API_KEY?: string;

  NOTIFY_TO?: string;               // a quién avisamos
  NOTIFY_FROM?: string;             // remitente; su dominio debe estar verificado
  NOTIFY_COOLDOWN_H?: string;       // horas mínimas entre avisos del MISMO hilo
  INBOX_URL?: string;

  // secrets — ver wrangler.jsonc
  WA_VERIFY_TOKEN?: string;
  WA_APP_SECRET?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  GATEWAY_SECRET?: string;
  ADMIN_TOKEN?: string;
}

export interface EmailMessage {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}
