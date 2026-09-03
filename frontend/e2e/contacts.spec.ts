/**
 * E2E tests for the contacts page /contacts (issue #537).
 * Covers:
 *  1. Adding a contact and seeing it appear in the list.
 *  2. Editing and deleting a contact.
 *  3. Tag-based filtering narrowing the visible contacts.
 */
import { test, expect } from "./fixtures";

const ALICE_ADDRESS = "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";
const BOB_ADDRESS = "GCFVV3BKTNNXJ46CY2TLAGRYFSP23HKEMP5CJFQU3EBACWSGYRQB5LEE";

test.beforeEach(async ({ page }) => {
  // Contacts persist in localStorage — start each test with an empty address book.
  await page.addInitScript(() => {
    window.localStorage.removeItem("stellar-micropay:contacts");
    window.localStorage.removeItem("stellar-micropay-contacts");
    window.localStorage.removeItem("stellar-micropay:favourites");
  });
});

async function addContact(
  page: import("@playwright/test").Page,
  name: string,
  address: string,
  tag?: string
) {
  await page.getByPlaceholder("e.g., Alice, Daily Coffee").fill(name);
  await page.getByPlaceholder("G... (56 character public key)").fill(address);
  if (tag) {
    await page.getByPlaceholder("e.g. exchange, family").fill(tag);
    await page.getByRole("button", { name: "Add" }).click();
  }
  await page.getByRole("button", { name: "Save Contact" }).click();
  await expect(page.getByText("Contact saved")).toBeVisible();
}

test("adding a contact makes it appear in the list", async ({ page }) => {
  await page.goto("/contacts");

  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("No contacts yet. Add one to get started.")).toBeVisible();

  await addContact(page, "Alice", ALICE_ADDRESS);

  const card = page.locator(".card-hover").filter({ hasText: "Alice" });
  await expect(card).toBeVisible();
  await expect(card.getByText(ALICE_ADDRESS)).toBeVisible();
  await expect(page.getByText("1 contact")).toBeVisible();
});

test("rejects an invalid Stellar address before saving", async ({ page }) => {
  await page.goto("/contacts");

  await page.getByPlaceholder("e.g., Alice, Daily Coffee").fill("Bad Contact");
  await page.getByPlaceholder("G... (56 character public key)").fill("not-a-valid-address");

  await expect(page.getByText("Invalid Stellar address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Contact" })).toBeDisabled();
});

test("editing a contact updates it in the list", async ({ page }) => {
  await page.goto("/contacts");
  await addContact(page, "Alice", ALICE_ADDRESS);

  const card = page.locator(".card-hover").filter({ hasText: "Alice" });
  await card.getByTitle("Edit contact").click();

  await expect(page.getByRole("heading", { name: "Edit Contact" })).toBeVisible();
  await page.getByPlaceholder("e.g., Alice, Daily Coffee").fill("Alice Updated");
  await page.getByRole("button", { name: "Update Contact" }).click();

  await expect(page.getByText("Contact updated")).toBeVisible();
  await expect(page.locator(".card-hover").filter({ hasText: "Alice Updated" })).toBeVisible();
  await expect(page.locator(".card-hover").filter({ hasText: "Alice" })).toHaveCount(1);
});

test("deleting a contact removes it from the list", async ({ page }) => {
  await page.goto("/contacts");
  await addContact(page, "Alice", ALICE_ADDRESS);

  const card = page.locator(".card-hover").filter({ hasText: "Alice" });
  await card.getByTitle("Delete contact").click();

  await expect(page.getByText("Contact deleted")).toBeVisible();
  await expect(page.getByText("No contacts yet. Add one to get started.")).toBeVisible();
  await expect(page.locator(".card-hover").filter({ hasText: "Alice" })).toHaveCount(0);
});

test("tag filter narrows the visible contacts", async ({ page }) => {
  await page.goto("/contacts");

  await addContact(page, "Alice", ALICE_ADDRESS, "family");
  await addContact(page, "Bob", BOB_ADDRESS, "exchange");

  await expect(page.getByText("2 contacts")).toBeVisible();

  const filterBar = page.locator("div").filter({ hasText: "Filter:" }).last();
  await filterBar.getByRole("button", { name: "family" }).click();

  await expect(page.locator(".card-hover").filter({ hasText: "Alice" })).toBeVisible();
  await expect(page.locator(".card-hover").filter({ hasText: "Bob" })).not.toBeVisible();
  await expect(page.getByText("1 contact")).toBeVisible();

  await filterBar.getByRole("button", { name: "All" }).click();
  await expect(page.locator(".card-hover").filter({ hasText: "Bob" })).toBeVisible();
  await expect(page.getByText("2 contacts")).toBeVisible();
});
