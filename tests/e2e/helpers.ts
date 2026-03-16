import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "playwright/test";

const execFileAsync = promisify(execFile);
const baseURL = "http://127.0.0.1:4173";
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function resolveAdminPassword() {
  const envFilePath = fileURLToPath(new URL("../../.dev.vars", import.meta.url));

  if (existsSync(envFilePath)) {
    const envFile = readFileSync(envFilePath, "utf8");
    const match = envFile.match(/^ADMIN_PASSWORD=(.*)$/m);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "AdminPassword123!#";
}

const adminPassword = resolveAdminPassword();

export function makeDomainName(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}.test`;
}

export async function stubTurnstile(page: Page, token = "e2e-turnstile-token") {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
(() => {
  const issuedToken = ${JSON.stringify(token)};
  let counter = 0;
  const widgets = new Map();

  window.turnstile = {
    render(container, options) {
      const widgetId = \`widget-\${++counter}\`;
      const host = document.createElement("div");
      host.setAttribute("data-e2e-turnstile", options.action ?? "");
      host.textContent = "E2E Turnstile";
      container.replaceChildren(host);
      widgets.set(widgetId, { container, options });
      Promise.resolve().then(() => options.callback(issuedToken));
      return widgetId;
    },
    reset(widgetId) {
      const widget = widgets.get(widgetId);
      if (widget) {
        Promise.resolve().then(() => widget.options.callback(issuedToken));
      }
    },
    remove(widgetId) {
      const widget = widgets.get(widgetId);
      if (widget) {
        widget.container.replaceChildren();
        widgets.delete(widgetId);
      }
    },
  };
})();
      `,
    });
  });
}

export async function signInAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Admin password").fill(adminPassword);
  const signInButton = page.getByRole("button", { name: "Sign in" });
  await expect(signInButton).toBeEnabled({ timeout: 15_000 });
  await signInButton.click();
  await expect(page.getByText("Authenticated")).toBeVisible();
}

export function getDomainCard(page: Page, domain: string) {
  return page
    .locator("div.rounded-xl")
    .filter({
      has: page.locator("strong", { hasText: domain }),
    })
    .filter({
      has: page.getByRole("button", { name: /Disable|Enable/ }),
    })
    .first();
}

export async function addDomain(page: Page, domain: string) {
  await page.getByPlaceholder("example.com").fill(domain);
  await page.getByRole("button", { name: "Add domain" }).click();
  await expect(getDomainCard(page, domain)).toContainText(domain);
}

export async function createTemporaryInbox(page: Page, domain: string) {
  await page.goto("/");
  await page.getByLabel("Domain").selectOption(domain);
  const createInboxButton = page.getByRole("button", { name: "Create inbox" });
  await expect(createInboxButton).toBeEnabled({ timeout: 15_000 });
  await createInboxButton.click();
  await expect(page).toHaveURL(/\/inbox\//);
  const address = (await page.getByRole("heading", { level: 1 }).textContent())?.trim();

  if (!address) {
    throw new Error("Inbox address was not rendered.");
  }

  return address;
}

export async function sendLocalEmail(options: {
  htmlRemoteTest?: boolean;
  htmlTest?: boolean;
  subject: string;
  to: string;
}) {
  const args = [
    "run",
    "email:local",
    "--",
    "--to",
    options.to,
    "--endpoint",
    `${baseURL}/cdn-cgi/handler/email`,
    "--subject",
    options.subject,
  ];

  if (options.htmlRemoteTest) {
    args.push("--html-remote-test");
  } else if (options.htmlTest) {
    args.push("--html-test");
  }

  await execFileAsync("npm", args, {
    cwd: projectRoot,
    env: process.env,
  });
}

export async function waitForEmail(page: Page, subject: string) {
  const emailItem = page.locator("aside button").filter({ hasText: subject }).first();

  try {
    await expect(emailItem).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(emailItem).toBeVisible({ timeout: 15_000 });
  }

  return emailItem;
}

export async function openEmail(page: Page, subject: string) {
  const emailItem = await waitForEmail(page, subject);
  await emailItem.click();
  await expect(page.getByRole("heading", { level: 2, name: subject })).toBeVisible();
}
