// @cms-core/cli — configuração de Auth do Supabase no provisionamento.
//
// Duas coisas que o projeto Supabase NÃO traz de fábrica e que, sem elas, o CMS
// nasce quebrado ou aberto:
//
// 1. TEMPLATES DE E-MAIL. O template padrão usa `{{ .ConfirmationURL }}`, que
//    aponta para `/auth/v1/verify` do Supabase e devolve a sessão no FRAGMENTO
//    da URL (`/#access_token=…`). Fragmento nunca chega ao servidor, então o
//    Server Component roda o guard, não vê cookie e manda para `/login` — o
//    convite e a recuperação de senha morrem no caminho, com o e-mail chegando
//    normalmente. A rota `app/auth/confirm/route.ts` do template do cliente lê
//    `token_hash` da QUERY (fluxo server-side correto), então é isso que o link
//    precisa carregar. Descoberto no primeiro uso real de um CMS gerado.
//
// 2. ENDURECIMENTO. Projeto novo nasce com cadastro público ABERTO e senha
//    mínima de 6. Num CMS onde `profiles` define quem é admin, cadastro aberto
//    é meio caminho para uma escalada de privilégio.
//
// ⚠️ ORDEM IMPORTA. No plano Free, `mailer_*` só é editável DEPOIS de existir
// SMTP customizado — a API responde 400 "Email template modification is not
// available for free tier projects using the default email provider". Por isso
// o adapter faz dois PATCH: SMTP primeiro, templates depois.
//
// ⚠️ IDIOMA. A fábrica não é português-only (mesma regra do dicionário do core):
// o padrão é inglês e o pt-BR entra quando `locales.default` começa com "pt".
// Um idioma novo é uma entrada a mais em TEXTOS, sem tocar no mecanismo.

import type { ClientConfig } from "@cms-core/core/config";

/** Escapa o que vai para dentro do HTML do e-mail (o adminTitle é livre). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TextosEmail {
  recoverySubject: (marca: string) => string;
  recoveryBody: (marca: string, link: string) => string;
  inviteSubject: (marca: string) => string;
  inviteBody: (marca: string, link: string) => string;
  changedSubject: () => string;
  changedBody: (marca: string) => string;
}

const TEXTOS: Record<"en" | "pt", TextosEmail> = {
  en: {
    recoverySubject: (m) => `Reset your ${m} password`,
    recoveryBody: (m, link) => `<h2>Reset your password</h2>

<p>We received a request to reset the password for your ${m} access. Use the link below to choose a new one.</p>
<p><a href="${link}">Reset password</a></p>

<p>The link is valid for one hour and can only be used once.</p>
<p>If this wasn't you, ignore this email &mdash; your password stays the same.</p>`,
    inviteSubject: (m) => `Your ${m} access`,
    inviteBody: (m, link) => `<h2>Your ${m} access</h2>

<p>You have been invited to manage content in ${m}. Use the link below to create your password and activate the account.</p>
<p><a href="${link}">Create my password</a></p>

<p>On first sign-in you will also set up two-step verification with an authenticator app. Access is not possible without it.</p>
<p>If you weren't expecting this invitation, ignore this email.</p>`,
    changedSubject: () => "Your password was changed",
    changedBody: (m) => `<h2>Your password was changed</h2>

<p>The password for your ${m} access was just changed.</p>
<p>If this wasn't you, reset your password immediately and tell whoever administers the system.</p>`,
  },
  pt: {
    recoverySubject: (m) => `Redefinir a senha do ${m}`,
    recoveryBody: (m, link) => `<h2>Redefinir sua senha</h2>

<p>Recebemos um pedido para redefinir a senha do seu acesso ao ${m}. Use o link abaixo para escolher uma nova.</p>
<p><a href="${link}">Redefinir senha</a></p>

<p>O link vale por 1 hora e s&oacute; pode ser usado uma vez.</p>
<p>Se n&atilde;o foi voc&ecirc; quem pediu, pode ignorar este e-mail &mdash; sua senha continua a mesma.</p>`,
    inviteSubject: (m) => `Seu acesso ao ${m}`,
    inviteBody: (m, link) => `<h2>Seu acesso ao ${m}</h2>

<p>Voc&ecirc; foi convidado para administrar o conte&uacute;do do ${m}. Use o link abaixo para criar sua senha e ativar o acesso.</p>
<p><a href="${link}">Criar minha senha</a></p>

<p>No primeiro acesso voc&ecirc; tamb&eacute;m vai configurar a verifica&ccedil;&atilde;o em duas etapas, usando um aplicativo autenticador no celular. Sem ela n&atilde;o &eacute; poss&iacute;vel entrar.</p>
<p>Se voc&ecirc; n&atilde;o esperava este convite, pode ignorar este e-mail.</p>`,
    changedSubject: () => "Sua senha foi alterada",
    changedBody: (m) => `<h2>Sua senha foi alterada</h2>

<p>A senha do seu acesso ao ${m} acabou de ser alterada.</p>
<p>Se n&atilde;o foi voc&ecirc;, redefina a senha imediatamente e avise quem administra o sistema.</p>`,
  },
};

function textosPara(locale: string): TextosEmail {
  return locale.toLowerCase().startsWith("pt") ? TEXTOS.pt : TEXTOS.en;
}

/** URL do admin a partir do config (o `adminSubdomain` é host, sem esquema). */
export function adminOrigin(config: ClientConfig): string {
  const host = config.domains.adminSubdomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}`;
}

/**
 * Endurecimento de Auth — aplicável SEMPRE, independe de SMTP.
 *
 * `site_url` importa mais do que parece: é o destino padrão dos links de e-mail
 * e o default de um projeto novo é `http://localhost:3000`. Sem corrigir, o
 * cliente clica no link de recuperação e cai no localhost da máquina dele.
 */
export function buildAuthHardening(config: ClientConfig): Record<string, unknown> {
  const origin = adminOrigin(config);
  return {
    site_url: origin,
    uri_allow_list: `${origin}/**`,
    // O CMS cria gente por convite. Cadastro aberto + `profiles` mandando no
    // papel de admin é caminho de escalada de privilégio.
    disable_signup: true,
    password_min_length: 12,
    password_required_characters:
      "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  };
}

/**
 * Templates de e-mail — exige SMTP customizado já configurado no plano Free.
 *
 * O `next=` é redundante com o fallback da rota (`invite`/`recovery` já caem em
 * `/auth/update-password`), mas fica explícito: quem for ler o e-mail cru
 * entende para onde o link leva sem abrir o código.
 */
export function buildAuthEmailTemplates(config: ClientConfig): Record<string, unknown> {
  const t = textosPara(config.locales.default);
  const marca = esc(config.branding.adminTitle);
  const link = (tipo: "recovery" | "invite") =>
    `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${tipo}&amp;next=/auth/update-password`;

  return {
    mailer_subjects_recovery: t.recoverySubject(marca),
    mailer_templates_recovery_content: t.recoveryBody(marca, link("recovery")),
    mailer_subjects_invite: t.inviteSubject(marca),
    mailer_templates_invite_content: t.inviteBody(marca, link("invite")),
    // Com e-mail saindo de verdade, o aviso de senha alterada passa a valer:
    // é o sinal que denuncia conta invadida enquanto dá tempo de reagir.
    mailer_subjects_password_changed_notification: t.changedSubject(),
    mailer_templates_password_changed_notification_content: t.changedBody(marca),
    mailer_notifications_password_changed_enabled: true,
  };
}
