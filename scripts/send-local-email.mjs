import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_FROM = "sender@example.com";
const DEFAULT_FROM_NAME = "Flamemail Local Sender";
const DEFAULT_SUBJECT = "Flamemail local test";
const DEFAULT_HOST = "127.0.0.1";
const EMAIL_HANDLER_PATH = "/cdn-cgi/handler/email";
const PUBLIC_CONFIG_PATH = "/api/public/config";
const ROOT_PATH = "/";
const DEFAULT_ENDPOINT_DESCRIPTION = "auto-detect running local Flamemail dev server";
const PROBE_FROM = "probe@flamemail.local";
const PROBE_TO = "probe@flamemail.local";
const PROBE_TIMEOUT_MS = 750;
const FLAMEMAIL_TITLE_MARKER = "<title>flamemail</title>";
const FLAMEMAIL_DESCRIPTION_MARKER = "flamemail is a disposable email service built on cloudflare workers.";
const TURNSTILE_UNAVAILABLE_ERROR = "Human verification is temporarily unavailable.";
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sWw2i8AAAAASUVORK5CYII=";

function createDefaultCandidatePorts() {
  const ports = [];

  for (let port = 5173; port <= 5193; port += 1) {
    ports.push(port);
  }

  ports.push(4173);
  return ports;
}

const DEFAULT_CANDIDATE_PORTS = createDefaultCandidatePorts();

function printHelp() {
  console.log(`Send a local test email to the Worker email() handler.

Usage:
  npm run email:local -- --to inbox@example.com
  npm run email:local -- --to inbox@example.com --attachment ./photo.jpg
  npm run email:local -- --to inbox@example.com --picture
  npm run email:local -- --to inbox@example.com --html-test
  npm run email:local -- --to inbox@example.com --from-name "QA Sender"
  npm run email:local -- --to inbox@example.com --subject "Testing" --html "<p>Hello</p>"

Options:
  --to <address>           Recipient address. Required.
  --from <address>         Envelope/header sender address. Default: ${DEFAULT_FROM}
  --from-name <text>       Display name for the From header. Default: ${DEFAULT_FROM_NAME}
  --subject <text>         Subject line. Default: ${DEFAULT_SUBJECT}
  --text <text>            Plain-text body.
  --html <html>            HTML body.
  --html-test              Use a built-in HTML test message.
  --html-remote-test       Use a built-in HTML test message with remote assets.
  --attachment <path>      Attach a file. Repeatable.
  --picture                Attach a built-in sample PNG.
  --endpoint <url>         Local email endpoint. Default: ${DEFAULT_ENDPOINT_DESCRIPTION}
  --write-eml <path>       Save the generated MIME message to disk.
  --dry-run                Build the email but do not POST it.
  --help                   Show this help.
`);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const options = {
    attachments: [],
    dryRun: false,
    endpoint: "",
    from: DEFAULT_FROM,
    fromName: DEFAULT_FROM_NAME,
    html: "",
    htmlRemoteTest: false,
    htmlTest: false,
    includePicture: false,
    subject: DEFAULT_SUBJECT,
    text: "Hello from Flamemail local development.",
    to: "",
    writeEml: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help") {
      printHelp();
      process.exit(0);
    }

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--picture") {
      options.includePicture = true;
      continue;
    }

    if (token === "--html-test") {
      options.htmlTest = true;
      continue;
    }

    if (token === "--html-remote-test") {
      options.htmlRemoteTest = true;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    index += 1;

    switch (token) {
      case "--to":
        options.to = value;
        break;
      case "--from":
        options.from = value;
        break;
      case "--subject":
        options.subject = value;
        break;
      case "--from-name":
        options.fromName = value;
        break;
      case "--text":
        options.text = value;
        break;
      case "--html":
        options.html = value;
        break;
      case "--attachment":
        options.attachments.push(value);
        break;
      case "--endpoint":
        options.endpoint = value;
        break;
      case "--write-eml":
        options.writeEml = value;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!options.to) {
    throw new Error("Missing required --to address");
  }

  if (options.htmlTest && !options.html) {
    options.html = `
      <html>
        <body style="margin:0;padding:24px;background:#f7f1e7;color:#241914;font-family:Georgia,serif;">
          <div style="max-width:640px;margin:0 auto;background:#fffaf3;border:1px solid #e6d5bf;border-radius:18px;overflow:hidden;">
            <div style="padding:20px 24px;background:linear-gradient(135deg,#0d5e52,#bc6c25);color:#fffaf3;">
              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.88;">Flamemail Local Test</div>
              <h1 style="margin:10px 0 0;font-size:32px;line-height:1.1;">HTML delivery works</h1>
            </div>
            <div style="padding:24px;line-height:1.6;">
              <p>This is a built-in HTML test message generated by <code>npm run email:local -- --html-test</code>.</p>
              <p>It helps verify:</p>
              <ul>
                <li>HTML body storage in R2</li>
                <li>HTML parsing via <code>postal-mime</code></li>
                <li>iframe rendering in the inbox UI</li>
              </ul>
              <p>
                <a href="https://developers.cloudflare.com/" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#0d5e52;color:#fffaf3;text-decoration:none;border-radius:999px;">Open Cloudflare Docs</a>
              </p>
            </div>
          </div>
        </body>
      </html>
    `.trim();
  }

  if (options.htmlRemoteTest && !options.html) {
    options.html = `
      <html>
        <body style="margin:0;padding:24px;background:#f7f1e7;color:#241914;font-family:Georgia,serif;">
          <div style="max-width:640px;margin:0 auto;background:#fffaf3;border:1px solid #e6d5bf;border-radius:18px;overflow:hidden;">
            <div style="padding:20px 24px;color:#fffaf3;background-color:#0d5e52;background-image:linear-gradient(rgba(13, 94, 82, 0.72), rgba(188, 108, 37, 0.72)), url('https://placehold.co/1200x420/png?text=Remote+background');background-position:center;background-repeat:no-repeat;background-size:cover;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.88;">Flamemail Local Test</div>
                <h1 style="margin:10px 0 0;font-size:32px;line-height:1.1;">HTML delivery works</h1>
              </div>
              <div style="padding:24px;line-height:1.6;">
                <p>This is a built-in HTML test message generated by <code>npm run email:local -- --html-remote-test</code>.</p>
                <p>It helps verify:</p>
                <ul>
                  <li>HTML body storage in R2</li>
                  <li>HTML parsing via <code>postal-mime</code></li>
                  <li>iframe rendering in the inbox UI</li>
                  <li>remote-content blocking for CSS backgrounds and inline images</li>
                </ul>
                <p>
                  <img
                    src="https://placehold.co/640x260/png?text=Remote+inline+image"
                    alt="Remote inline image"
                    style="display:block;width:100%;height:auto;border-radius:14px;border:1px solid #e6d5bf;"
                  />
                </p>
                <p>
                  <a href="https://developers.cloudflare.com/" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;background:#0d5e52;color:#fffaf3;text-decoration:none;border-radius:999px;">Open Cloudflare Docs</a>
                </p>
              </div>
            </div>
        </body>
      </html>
    `.trim();
  }

  return options;
}

function sanitizeHeader(value) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatMailbox(address, name = "") {
  const sanitizedAddress = sanitizeHeader(address);
  const sanitizedName = sanitizeHeader(name);

  if (!sanitizedName) {
    return `<${sanitizedAddress}>`;
  }

  return `"${sanitizedName.replace(/["\\]/g, "\\$&")}" <${sanitizedAddress}>`;
}

function wrapBase64(value) {
  return value.replace(/(.{76})/g, "$1\r\n");
}

function buildEmailHandlerEndpoint({ host = DEFAULT_HOST, port }) {
  return `http://${host}:${port}${EMAIL_HANDLER_PATH}`;
}

function buildBaseUrl({ host = DEFAULT_HOST, port }) {
  return `http://${host}:${port}`;
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeFlamemailRoot(baseUrl, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await fetchWithTimeout(new URL(ROOT_PATH, baseUrl), {
      fetchImpl,
      method: "GET",
      timeoutMs,
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      return false;
    }

    const body = (await response.text()).toLowerCase();
    return body.includes(FLAMEMAIL_TITLE_MARKER) || body.includes(FLAMEMAIL_DESCRIPTION_MARKER);
  } catch {
    return false;
  }
}

async function probeFlamemailConfig(baseUrl, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await fetchWithTimeout(new URL(PUBLIC_CONFIG_PATH, baseUrl), {
      fetchImpl,
      method: "GET",
      timeoutMs,
    });

    if (response.status !== 200 && response.status !== 503) {
      return false;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      return false;
    }

    const body = await response.json();

    if (response.status === 200) {
      return typeof body?.turnstileSiteKey === "string" && body.turnstileSiteKey.length > 0;
    }

    return body?.error === TURNSTILE_UNAVAILABLE_ERROR;
  } catch {
    return false;
  }
}

async function probeFlamemailApp(baseUrl, options = {}) {
  const [isFlamemailRoot, isFlamemailConfig] = await Promise.all([
    probeFlamemailRoot(baseUrl, options),
    probeFlamemailConfig(baseUrl, options),
  ]);

  return isFlamemailRoot && isFlamemailConfig;
}

async function probeEmailHandler(endpoint, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const probeUrl = new URL(endpoint);

  probeUrl.searchParams.set("from", PROBE_FROM);
  probeUrl.searchParams.set("to", PROBE_TO);

  try {
    const response = await fetchWithTimeout(probeUrl, {
      fetchImpl,
      method: "GET",
      timeoutMs,
    });
    const body = await response.text();

    return response.status === 400 && body.includes("Invalid email");
  } catch {
    return false;
  }
}

export async function detectLocalEmailEndpoint({
  candidatePorts = DEFAULT_CANDIDATE_PORTS,
  fetchImpl = fetch,
  host = DEFAULT_HOST,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const checkedPorts = [];

  for (const port of candidatePorts) {
    checkedPorts.push(port);

    const baseUrl = buildBaseUrl({ host, port });
    const isFlamemailApp = await probeFlamemailApp(baseUrl, { fetchImpl, timeoutMs });

    if (!isFlamemailApp) {
      continue;
    }

    const endpoint = buildEmailHandlerEndpoint({ host, port });
    const isMatch = await probeEmailHandler(endpoint, { fetchImpl, timeoutMs });

    if (isMatch) {
      return endpoint;
    }
  }

  throw new Error(
    `Could not detect a local Flamemail dev server. Checked ports: ${checkedPorts.join(", ")}. Start npm run dev or pass --endpoint.`,
  );
}

export async function resolveEndpoint(options, { detectEndpoint = detectLocalEmailEndpoint } = {}) {
  if (options.endpoint) {
    return options.endpoint;
  }

  if (options.dryRun) {
    return null;
  }

  return detectEndpoint();
}

function guessContentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function createTextPart(contentType, body) {
  return [`Content-Type: ${contentType}`, "Content-Transfer-Encoding: 7bit", "", body].join("\r\n");
}

function createAttachmentPart(attachment) {
  return [
    `Content-Type: ${attachment.contentType}; name="${sanitizeHeader(attachment.filename)}"`,
    `Content-Disposition: attachment; filename="${sanitizeHeader(attachment.filename)}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(attachment.content.toString("base64")),
  ].join("\r\n");
}

function buildBody({ attachments, html, text }) {
  const hasText = text.trim().length > 0;
  const hasHtml = html.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const alternativeBoundary = `alt_${randomUUID()}`;

  if (!hasAttachments && hasText && !hasHtml) {
    return {
      contentType: "text/plain; charset=utf-8",
      body: text,
    };
  }

  if (!hasAttachments && !hasText && hasHtml) {
    return {
      contentType: "text/html; charset=utf-8",
      body: html,
    };
  }

  if (!hasAttachments && hasText && hasHtml) {
    const parts = [
      `--${alternativeBoundary}`,
      createTextPart("text/plain; charset=utf-8", text),
      `--${alternativeBoundary}`,
      createTextPart("text/html; charset=utf-8", html),
      `--${alternativeBoundary}--`,
    ].join("\r\n");

    return {
      contentType: `multipart/alternative; boundary="${alternativeBoundary}"`,
      body: parts,
    };
  }

  const mixedBoundary = `mixed_${randomUUID()}`;
  const parts = [];

  if (hasText || hasHtml) {
    if (hasText && hasHtml) {
      const alternativeParts = [
        `--${alternativeBoundary}`,
        createTextPart("text/plain; charset=utf-8", text),
        `--${alternativeBoundary}`,
        createTextPart("text/html; charset=utf-8", html),
        `--${alternativeBoundary}--`,
      ].join("\r\n");

      parts.push(
        [
          `--${mixedBoundary}`,
          `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
          "",
          alternativeParts,
        ].join("\r\n"),
      );
    } else if (hasText) {
      parts.push([`--${mixedBoundary}`, createTextPart("text/plain; charset=utf-8", text)].join("\r\n"));
    } else {
      parts.push([`--${mixedBoundary}`, createTextPart("text/html; charset=utf-8", html)].join("\r\n"));
    }
  }

  for (const attachment of attachments) {
    parts.push([`--${mixedBoundary}`, createAttachmentPart(attachment)].join("\r\n"));
  }

  parts.push(`--${mixedBoundary}--`);

  return {
    contentType: `multipart/mixed; boundary="${mixedBoundary}"`,
    body: parts.join("\r\n"),
  };
}

async function loadAttachments(options) {
  const items = await Promise.all(
    options.attachments.map(async (filePath) => {
      const content = await readFile(filePath);
      return {
        content,
        contentType: guessContentType(filePath),
        filename: path.basename(filePath),
      };
    }),
  );

  if (options.includePicture) {
    items.push({
      content: Buffer.from(SAMPLE_PNG_BASE64, "base64"),
      contentType: "image/png",
      filename: "sample-picture.png",
    });
  }

  return items;
}

function buildMimeMessage({ attachments, from, fromName, html, subject, text, to }) {
  const payload = buildBody({ attachments, html, text });
  const headers = [
    `From: ${formatMailbox(from, fromName)}`,
    `To: <${sanitizeHeader(to)}>`,
    `Subject: ${sanitizeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@flamemail.local>`,
    "MIME-Version: 1.0",
    `Content-Type: ${payload.contentType}`,
    "",
    payload.body,
    "",
  ];

  return headers.join("\r\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const attachments = await loadAttachments(options);
  const mimeMessage = buildMimeMessage({
    attachments,
    from: options.from,
    fromName: options.fromName,
    html: options.html,
    subject: options.subject,
    text: options.text,
    to: options.to,
  });

  if (options.writeEml) {
    await writeFile(options.writeEml, mimeMessage, "utf8");
  }

  let resolvedEndpoint = options.endpoint || null;

  console.log(`Prepared local email:`);
  console.log(`- To: ${options.to}`);
  console.log(`- From: ${formatMailbox(options.from, options.fromName)}`);
  console.log(`- Subject: ${options.subject}`);
  console.log(`- Attachments: ${attachments.length}`);
  console.log(`- Endpoint: ${resolvedEndpoint ?? "auto-detect on send"}`);

  if (options.dryRun) {
    console.log("Dry run complete. Email was not sent.");
    return;
  }

  if (!resolvedEndpoint) {
    resolvedEndpoint = await resolveEndpoint(options);
    console.log(`Detected local email endpoint: ${resolvedEndpoint}`);
  }

  const endpoint = new URL(resolvedEndpoint);
  endpoint.searchParams.set("from", options.from);
  endpoint.searchParams.set("to", options.to);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
    body: mimeMessage,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Local email request failed with ${response.status}: ${body}`);
  }

  const body = await response.text();
  console.log("Email sent to local worker endpoint.");
  if (body.trim()) {
    console.log(body);
  }
}

function isMainModule() {
  const entryPoint = process.argv[1];

  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPoint).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error("Run with --help to see usage.");
    process.exit(1);
  });
}
