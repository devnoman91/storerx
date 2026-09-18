import { describe, expect, it } from "vitest";
import { cartRules } from "../../app/rules/cart";
import { UNCHECKED } from "../../app/rules/types";
import { checked, fixture, run } from "./helpers";

const emptyCart = fixture("dawn", "cart");
const check = (id: string, html: string) => checked(run(cartRules, id, { html }));

/**
 * A cart with one line item. StoreRx's own scans only ever see an empty cart,
 * so this is the shape the item-dependent rules are written against.
 */
function filledCart(extras = ""): string {
  return `<main><section class="shopify-section"><form action="/cart" method="post">
    <table><tr class="cart-item"><td><a href="/products/mug">Mug</a></td>
      <td><input name="updates[]" value="1"></td></tr></table>
    <div class="cart__footer">${extras}<button name="checkout">Check out</button></div>
  </form></section></main>`;
}

describe("an empty cart", () => {
  it("checks the drawer, which is part of the layout", () => {
    // Dawn's demo uses the add-to-cart notification rather than a drawer.
    expect(check("cart.drawer", emptyCart)).toBeNull();
  });

  it("does not report missing features an empty cart never shows", () => {
    for (const id of ["cart.shipping.bar", "cart.upsell", "cart.trust", "cart.discount.prominent", "cart.express"]) {
      expect(run(cartRules, id, { html: emptyCart }), id).toBe(UNCHECKED);
    }
  });
});

describe("cart.drawer", () => {
  it("fires when adding to cart sends shoppers to the cart page", () => {
    expect(check("cart.drawer", "<main><p>Cart</p></main>")?.ruleId).toBe("cart.drawer");
  });
});

describe("a cart with items", () => {
  it("reports what a bare cart is missing", () => {
    const bare = filledCart();
    expect(check("cart.shipping.bar", bare)?.ruleId).toBe("cart.shipping.bar");
    expect(check("cart.upsell", bare)?.ruleId).toBe("cart.upsell");
    expect(check("cart.trust", bare)?.ruleId).toBe("cart.trust");
    expect(check("cart.express", bare)?.ruleId).toBe("cart.express");
    expect(check("cart.discount.prominent", bare)).toBeNull();
  });

  it("passes a cart that has them", () => {
    const full = filledCart(`
      <p>You're $12 away from free shipping</p>
      <h2>You may also like</h2>
      <p>Secure checkout · 30-day money-back guarantee</p>
      <div class="additional-checkout-buttons"></div>`);
    for (const id of ["cart.shipping.bar", "cart.upsell", "cart.trust", "cart.express"]) {
      expect(check(id, full), id).toBeNull();
    }
  });

  it("flags a discount field", () => {
    expect(check("cart.discount.prominent", filledCart('<input name="discount">'))?.ruleId).toBe(
      "cart.discount.prominent",
    );
  });
});
