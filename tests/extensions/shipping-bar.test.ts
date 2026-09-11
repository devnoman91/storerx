// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(
  join(__dirname, "..", "..", "extensions", "storerx-theme", "assets", "shipping-bar.js"),
  "utf8",
);

type Cart = { total_price: number; currency: string };

function mount({
  cart,
  currencyMatch = true,
  showWhenEmpty = true,
  rate,
}: {
  cart: Cart;
  currencyMatch?: boolean;
  showWhenEmpty?: boolean;
  rate?: number;
}) {
  document.body.innerHTML = `
    <div class="storerx-shipping-bar" role="status"
      data-threshold="5000" data-shop-currency="USD"
      data-currency-match="${currencyMatch}" data-show-when-empty="${showWhenEmpty}"
      data-msg-remaining="You're [amount] away from free shipping"
      data-msg-empty="Free shipping on orders over [amount]"
      data-msg-reached="You've unlocked free shipping">
      <p data-storerx-message></p>
      <progress max="5000" value="0"></progress>
      <button type="button" data-storerx-close></button>
    </div>`;

  let observe: ((list: { getEntries: () => Array<{ name: string }> }) => void) | undefined;
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(callback: typeof observe) {
        observe = callback;
      }
      observe() {}
    },
  );
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => cart }));
  vi.stubGlobal("fetch", fetchMock);
  (window as unknown as { Shopify: unknown }).Shopify = rate ? { currency: { rate } } : {};

  new Function(script)();

  const bar = () => document.querySelector<HTMLElement>(".storerx-shipping-bar");
  return {
    bar,
    fetchMock,
    message: () => document.querySelector("[data-storerx-message]")!.textContent,
    progress: () => document.querySelector("progress")!,
    request: (url: string) => observe?.({ getEntries: () => [{ name: url }] }),
  };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(200);
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shipping bar", () => {
  it("updates the remaining amount after the theme adds to cart", async () => {
    const bar = mount({ cart: { total_price: 2500, currency: "USD" } });
    bar.request("https://shop.myshopify.com/cart/add.js");
    await settle();

    expect(bar.fetchMock).toHaveBeenCalledWith("/cart.js", expect.anything());
    expect(bar.message()).toBe("You're $25.00 away from free shipping");
    expect(bar.progress().value).toBe(2500);
  });

  it("recognises cart changes from any theme endpoint, including locale-prefixed ones", async () => {
    for (const url of ["/cart/change.js", "/cart/update", "/fr/cart/add.js?sections=cart", "/cart/clear.js"]) {
      const bar = mount({ cart: { total_price: 1000, currency: "USD" } });
      bar.request(`https://shop.myshopify.com${url}`);
      await settle();
      expect(bar.fetchMock, url).toHaveBeenCalledTimes(1);
    }
  });

  it("does not refetch in a loop on its own /cart.js request", async () => {
    const bar = mount({ cart: { total_price: 1000, currency: "USD" } });
    bar.request("https://shop.myshopify.com/cart.js");
    await settle();
    expect(bar.fetchMock).not.toHaveBeenCalled();
  });

  it("ignores unrelated requests", async () => {
    const bar = mount({ cart: { total_price: 1000, currency: "USD" } });
    bar.request("https://shop.myshopify.com/products/cart-shaped-mug.js");
    await settle();
    expect(bar.fetchMock).not.toHaveBeenCalled();
  });

  it("celebrates once the threshold is reached", async () => {
    const bar = mount({ cart: { total_price: 6000, currency: "USD" } });
    bar.request("/cart/add.js");
    await settle();
    expect(bar.message()).toBe("You've unlocked free shipping");
    expect(bar.progress().value).toBe(5000);
  });

  it("hides on an empty cart when the merchant turned that off", async () => {
    const bar = mount({ cart: { total_price: 0, currency: "USD" }, showWhenEmpty: false });
    bar.request("/cart/change.js");
    await settle();
    expect(bar.bar()!.hidden).toBe(true);
  });

  it("converts the threshold into the shopper's currency", async () => {
    // Server can't convert, so it renders hidden and the script fetches straight away.
    const bar = mount({ cart: { total_price: 2000, currency: "EUR" }, currencyMatch: false, rate: 0.9 });
    await settle();

    expect(bar.fetchMock).toHaveBeenCalledTimes(1);
    expect(bar.message()).toBe("You're €25.00 away from free shipping");
    expect(bar.progress().max).toBe(4500);
  });

  it("debounces a burst of cart requests into one fetch", async () => {
    const bar = mount({ cart: { total_price: 1000, currency: "USD" } });
    bar.request("/cart/add.js");
    bar.request("/cart/change.js");
    bar.request("/cart/update.js");
    await settle();
    expect(bar.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays dismissed for the rest of the session", () => {
    const first = mount({ cart: { total_price: 1000, currency: "USD" } });
    document.querySelector<HTMLButtonElement>("[data-storerx-close]")!.click();
    expect(first.bar()).toBeNull();

    const next = mount({ cart: { total_price: 1000, currency: "USD" } });
    expect(next.bar()).toBeNull();
  });
});
