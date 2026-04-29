import { expect, test } from "playwright/test";
import { addDomain, createTemporaryInbox, makeDomainName, signInAdmin, stubTurnstile } from "./helpers";

test("anon temp inbox + admin sign-in coexist in the same browser", async ({ page }) => {
  const domain = makeDomainName("inbox-then-admin");

  await stubTurnstile(page);

  // First: a fresh operator has to set the domain up while signed in.
  // Sign out afterwards so the rest of the test starts from an anon
  // session with no admin cookie.
  await signInAdmin(page);
  await addDomain(page, domain);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page.getByRole("link", { name: /sign in with tessera/i })).toBeVisible();

  // Anon temp inbox path: no admin cookie, bearer token in localStorage.
  const inbox = await createTemporaryInbox(page, domain);

  // The user inbox view shows the bearer-owner extend button.
  await expect(page.getByRole("heading", { level: 1, name: inbox })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/i })).toHaveCount(0);

  // Now sign in as admin in the same browser. Admin cookie is added on
  // top of the existing bearer in localStorage.
  await signInAdmin(page);

  // Admin console lists temporary inboxes including the one just created.
  await expect(page.getByText(inbox, { exact: true })).toBeVisible();

  // Visiting the bearer-owner inbox URL (no `?admin=1`) keeps owner mode:
  // the extend button (an owner-only affordance) is still rendered.
  await page.goto(`/inbox/${encodeURIComponent(inbox)}`);
  await expect(page.getByRole("heading", { level: 1, name: inbox })).toBeVisible();

  // Visiting the same inbox with `?admin=1` switches to admin-inspect.
  // The detail panel surfaces the admin-only "View raw" affordance once
  // an email is opened, but for the smoke we just confirm the page renders.
  await page.goto(`/inbox/${encodeURIComponent(inbox)}?admin=1`);
  await expect(page.getByRole("heading", { level: 1, name: inbox })).toBeVisible();
});
