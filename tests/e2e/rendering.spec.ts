import { expect, test } from "playwright/test";
import {
  addDomain,
  createTemporaryInbox,
  makeDomainName,
  openEmail,
  sendLocalEmail,
  signInAdmin,
  stubTurnstile,
} from "./helpers";

test("@smoke blocks remote email content by default and rewrites external links", async ({ page }) => {
  const domain = makeDomainName("rendering");
  const subject = `Rendering smoke ${Date.now()}`;

  await stubTurnstile(page);
  await signInAdmin(page);
  await addDomain(page, domain);

  const address = await createTemporaryInbox(page, domain);

  await sendLocalEmail({
    to: address,
    subject,
    htmlRemoteTest: true,
  });

  await openEmail(page, subject);

  const emailFrame = page.frameLocator('iframe[title^="Email "]');
  await expect(page.getByRole("button", { name: "Load remote content" })).toBeVisible();
  await expect(emailFrame.getByText("Remote image blocked: Remote inline image")).toBeVisible();
  await expect(emailFrame.getByRole("link", { name: "Open Cloudflare Docs" })).toHaveAttribute(
    "href",
    /\/link\?url=https%3A%2F%2Fdevelopers\.cloudflare\.com%2F/,
  );
});
