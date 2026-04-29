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

test("@smoke creates an inbox, receives mail, extends it, and deletes it", async ({ page }) => {
  const domain = makeDomainName("inbox-flow");
  const subject = `Inbox smoke ${Date.now()}`;

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
  await expect(page.getByRole("button", { name: "Load remote content" })).toBeVisible();

  await page.getByRole("button", { name: "Extend 72h" }).click();
  await expect(page.getByText("Inbox extended to 72h")).toBeVisible();

  // Two "Delete" buttons render once an email is open: one in the inbox
  // header (opens the confirm dialog) and one in the email detail panel.
  // `.first()` deterministically selects the header button which appears
  // earlier in DOM order. The React dialog confirms intent, then
  // useInboxPageActions runs a second native window.confirm before the
  // delete API call, so install a one-shot listener for it.
  page.on("dialog", (dialog) => {
    void dialog.accept();
  });
  await page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 1, name: address }) })
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Delete permanently" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Inbox deleted")).toBeVisible();
});
