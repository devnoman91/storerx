(() => {
  const bar = document.querySelector(".storerx-shipping-bar");
  if (!bar) return;

  const DISMISS_KEY = "storerx:shipping-bar:dismissed";
  try {
    if (sessionStorage.getItem(DISMISS_KEY)) {
      bar.remove();
      return;
    }
  } catch {}

  const threshold = Number(bar.dataset.threshold);
  const shopCurrency = bar.dataset.shopCurrency;
  const showWhenEmpty = bar.dataset.showWhenEmpty === "true";
  const message = bar.querySelector("[data-storerx-message]");
  const progress = bar.querySelector("progress");
  const root = window.Shopify?.routes?.root || "/";
  const locale = document.documentElement.lang || undefined;
  const CART_MUTATION = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

  const format = (cents, currency) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);

  const render = (cart) => {
    const rate = cart.currency === shopCurrency ? 1 : Number(window.Shopify?.currency?.rate) || 1;
    const goal = Math.round(threshold * rate);
    const total = cart.total_price;
    progress.max = Math.max(goal, 1);
    progress.value = Math.min(total, goal);
    if (total >= goal) {
      message.textContent = bar.dataset.msgReached;
    } else if (total === 0) {
      message.textContent = bar.dataset.msgEmpty.replace("[amount]", format(goal, cart.currency));
    } else {
      message.textContent = bar.dataset.msgRemaining.replace("[amount]", format(goal - total, cart.currency));
    }
    bar.hidden = total === 0 && !showWhenEmpty;
  };

  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const response = await fetch(`${root}cart.js`, { headers: { Accept: "application/json" } });
        if (response.ok) render(await response.json());
      } catch {}
    }, 150);
  };

  if ("PerformanceObserver" in window) {
    new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => CART_MUTATION.test(entry.name))) refresh();
    }).observe({ type: "resource" });
  }

  bar.querySelector("[data-storerx-close]")?.addEventListener("click", () => {
    bar.remove();
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refresh();
  });

  if (bar.dataset.currencyMatch !== "true") refresh();
})();
