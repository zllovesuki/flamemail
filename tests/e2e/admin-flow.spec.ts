import { expect, test } from "playwright/test";
import { addDomain, getDomainCard, makeDomainName, signInAdmin, stubTurnstile } from "./helpers";

test("@smoke signs in, manages a domain, and shows reserved permanent inboxes", async ({ page }) => {
  const domain = makeDomainName("admin-flow");

  await stubTurnstile(page);
  await signInAdmin(page);
  await addDomain(page, domain);

  const domainCard = getDomainCard(page, domain);
  await expect(domainCard).toContainText("active");

  await domainCard.getByRole("button", { name: "Disable" }).click();
  await expect(domainCard).toContainText("disabled");

  await domainCard.getByRole("button", { name: "Enable" }).click();
  await expect(domainCard).toContainText("active");

  await expect(page.getByText(`admin@${domain}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`postmaster@${domain}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`abuse@${domain}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`webmaster@${domain}`, { exact: true })).toBeVisible();
});
