import { expect, Page, test } from '@playwright/test';

// The five user stories, driven through the browser the way a person would:
// pick from a dropdown, type an email, click a button, read what comes back.
//
// What this catches that the API tests can't: the wiring between the pieces.
// A 200 with the right JSON body proves the endpoint works; it does not prove
// the page renders the answer, that the dropdown was populated from it, or
// that the count on the admin list actually moved. Those are the failures a
// user reports and a green unit-test suite happily misses.
//
// Serial, because the tests share one seeded database and later ones assert on
// state earlier ones created.

const OPEN_EVENT = 'Tech Innovation Summit 2026';
const CLOSED_EVENT = 'Past Members Networking (closed)';
// 4 registrations come from `seed --demo`; the flow below adds one more.
const SEEDED_REGISTRATIONS = 4;

/** The event dropdown on the public page. */
const openEventPicker = (page: Page) => page.getByRole('combobox').first();

/** Options in the open dropdown.
 *
 *  Matched on the role attribute rather than through getByRole: Radix renders
 *  the list into a portal and marks the rest of the page aria-hidden while it
 *  is open, and the accessibility-tree walk behind getByRole does not reliably
 *  reach the portalled options. The role attribute is what the component
 *  actually emits, so this is the same contract without the extra hop. */
const eventOptions = (page: Page) => page.locator('[role="option"]');

const pickEvent = async (page: Page, name: string | RegExp): Promise<void> => {
  await openEventPicker(page).click();
  const matcher = typeof name === 'string' ? new RegExp(name) : name;
  await eventOptions(page).filter({ hasText: matcher }).first().click();
};

/** Registered count for one event, read off the desktop table. */
const registeredCount = async (page: Page, eventName: string): Promise<number> => {
  const row = page.getByRole('row', { name: new RegExp(eventName) });
  const cell = await row.locator('td').nth(7).innerText();
  return Number.parseInt(cell.trim(), 10);
};

test.describe.serial('event registration flow', () => {
  const email = `e2e.${Date.now()}@example.com`;

  test('the public dropdown offers open events only', async ({ page }) => {
    await page.goto('/');

    await openEventPicker(page).click();
    await expect(eventOptions(page).first()).toBeVisible();

    const names = (await eventOptions(page).allInnerTexts()).map((text) => text.trim());
    expect(names.some((name) => name.includes(OPEN_EVENT))).toBe(true);
    // the closed event exists in the admin list but must never be offered here
    expect(names.some((name) => name.includes(CLOSED_EVENT))).toBe(false);

    await page.keyboard.press('Escape');
  });

  test('a visitor registers and receives a five-digit number', async ({ page }) => {
    await page.goto('/');
    await pickEvent(page, new RegExp(OPEN_EVENT));

    // selecting an event reveals its details, including the deadline
    await expect(page.getByText('Event Details')).toBeVisible();

    await page.getByLabel('Email Address').fill(email);
    await page.getByRole('button', { name: /^register$/i }).click();

    await expect(page.getByText(/thank you/i).first()).toBeVisible();
    // the number is what the visitor quotes at the door, so the format is
    // part of the contract, not a cosmetic detail
    await expect(page.getByText(/\b\d{5}\b/).first()).toBeVisible();
  });

  test('the same email is refused a second time, with a sentence', async ({ page }) => {
    await page.goto('/');
    await pickEvent(page, new RegExp(OPEN_EVENT));

    await page.getByLabel('Email Address').fill(email);
    await page.getByRole('button', { name: /^register$/i }).click();

    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible();
    // a person reading this has to know what to do next, so it names the
    // situation in words - not "emailAddress must be unique"
    await expect(alert).toContainText(/already registered/i);
    await expect(alert).not.toContainText(/emailAddress|isEmail|unique constraint/i);
  });

  test('editing the email clears the message', async ({ page }) => {
    await page.goto('/');
    await pickEvent(page, new RegExp(OPEN_EVENT));

    await page.getByLabel('Email Address').fill('not-an-email');
    await page.getByRole('button', { name: /^register$/i }).click();
    await expect(page.locator('[role="alert"]').first()).toBeVisible();

    await page.getByLabel('Email Address').fill('someone@example.com');
    // a message about the value that was submitted must not survive the value
    // being changed
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test('the admin list counts the registration that just happened', async ({ page }) => {
    await page.goto('/admin');

    const row = page.getByRole('row', { name: new RegExp(OPEN_EVENT) });
    await expect(row).toBeVisible();

    expect(await registeredCount(page, OPEN_EVENT)).toBe(SEEDED_REGISTRATIONS + 1);
  });

  test('the trend page shows the registration on the day it landed', async ({ page }) => {
    await page.goto('/admin');
    const row = page.getByRole('row', { name: new RegExp(OPEN_EVENT) });
    await row.getByRole('link', { name: /view trend/i }).click();

    await expect(page).toHaveURL(/\/admin\/events\/.+\/trend/);

    // the last row is the cumulative total up to the deadline day, which must
    // equal the count the admin list showed
    const lastRow = page.locator('tbody tr').last();
    await expect(lastRow).toContainText(String(SEEDED_REGISTRATIONS + 1));
  });

  test('a duplicate event name is refused, in words', async ({ page }) => {
    await page.goto('/admin/events/new');

    await page.getByLabel('Name').fill(OPEN_EVENT);
    await page.getByLabel('Event Date Time').fill('2026-12-20T09:00');
    await page.getByLabel('Postal Code').fill('018956');
    await page.getByLabel('Registration Deadline').fill('2026-12-15T18:00');
    await page.getByLabel('Capacity').fill('10');
    await page.getByRole('combobox').last().click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: /add event/i }).click();

    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/already exists/i);
    // still on the form - a rejected submission must not navigate away and
    // lose what the user typed
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
  });

  test('the whole flow works on a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });

    for (const path of ['/', '/admin']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }

    // the desktop table is replaced by cards at this width; both existing in
    // the DOM is fine, but only one may be laid out
    const layout = await page.evaluate(() => ({
      table: (document.querySelector('table') as HTMLElement | null)?.offsetParent !== null,
      cards: ([...document.querySelectorAll('ul.divide-y > li')] as HTMLElement[]).filter(
        (el) => el.offsetParent !== null,
      ).length,
    }));
    expect(layout.table).toBe(false);
    expect(layout.cards).toBeGreaterThan(0);
  });
});
